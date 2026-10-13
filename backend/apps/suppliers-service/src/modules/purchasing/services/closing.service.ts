import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { ProductsClient } from '../clients/products.client'
import { SalesClient } from '../clients/sales.client'
import { SupplyClient } from '../clients/supply.client'
import type { ClosingQueryDto, ConfirmClosingDto } from '../dto/closing.dto'
import { monthsTouched, viewRemovals, type PreviousClosingTotals, type RemovalsView } from '../utils/closing-removals'
import { viewStock, type StockLine } from '../utils/closing-stock'
import { previewClosing, type Preview, type PreviewIssue, type PreviewLine } from '../utils/closing-preview'
import type { CostRow } from '../utils/consignment-agreement'
import { findOverlap, type DayInterval } from '../utils/settlement-coverage'
import { addDays, isDay } from '../utils/week'
import { SettlementService, type SettlementView } from './settlement.service'

export interface ClosingPreviewView {
  supplier_id: number
  supplier_name: string
  period_from: string
  period_to: string
  /** ready | no_sales | incomplete come from the calculation; config_pending and conflict stop before it. */
  status: 'ready' | 'no_sales' | 'incomplete' | 'config_pending' | 'conflict'
  /** What the supplier still lacks before a closing can be calculated. */
  config_missing: Array<'products'>
  conflict: { settlement_id: number; period_from: string; period_to: string; state: string; suggested_from: string } | null
  lines: Array<PreviewLine & { name: string }>
  total_units: number
  total_cents: number
  configured_skus: number
  skus_without_sales: number
  issues: PreviewIssue[]
  /** Expired withdrawals and pending returns are not read by this basis yet: null means "not available", never zero. */
  /** What is left in the stores per configured product and the pace of sales: for the supplier and for deciding what to buy. Stock at home is not known here. null when the supply data could not be read. */
  stock: Array<StockLine & { name: string }> | null
  /** Expired, other reason (theft, borne by the owner) and returned units, by month and valued at the agreed cost: shown SEPARATELY, never added to `total_cents`. null when the supply data could not be read. */
  removals: (Omit<RemovalsView, 'lines'> & { lines: Array<RemovalsView['lines'][number] & { name: string }> }) | null
  /** A person may confirm this exact result (the server recomputes it on confirmation). */
  confirmable: boolean
}

export interface ClosingStatusView {
  last: SettlementView | null
  configured_skus: number
  period_days: number | null
  /** The next period not closed yet, from the last confirmed or paid one; null when there is nothing to suggest, with the reason. */
  suggested: { from: string; to: string } | null
  suggestion_reason: 'ok' | 'no_history' | 'nothing_closed_yet'
}

const day = (date: Date) => date.toISOString().slice(0, 10)
const date = (value: string) => new Date(`${value}T00:00:00Z`)
/** America/Sao_Paulo has been UTC-3 all year since 2019. */
const todaySp = () => day(new Date(Date.now() - 3 * 3_600_000))

@Injectable()
export class ClosingService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly sales: SalesClient,
    private readonly supply: SupplyClient,
    private readonly products: ProductsClient,
    private readonly settlements: SettlementService,
  ) {}

  async status(supplierId: number): Promise<ClosingStatusView> {
    await this.assertSupplier(supplierId)
    const [last, agreement, costs] = await Promise.all([
      this.settlements.last(supplierId),
      this.prisma.consignmentAgreement.findUnique({ where: { supplier_id: supplierId } }),
      this.prisma.consignmentCost.findMany({ where: { supplier_id: supplierId }, select: { sku: true }, distinct: ['sku'] }),
    ])
    const periodDays = agreement?.period_days ?? null
    const yesterday = addDays(todaySp(), -1)
    const from = last ? addDays(last.period_to, 1) : agreement?.first_closing_on ? day(agreement.first_closing_on) : null

    let suggested: ClosingStatusView['suggested'] = null
    let reason: ClosingStatusView['suggestion_reason'] = 'no_history'
    if (from) {
      const to = addDays(from, (periodDays ?? 7) - 1)
      const end = to > yesterday ? yesterday : to
      if (end >= from) {
        suggested = { from, to: end }
        reason = 'ok'
      } else reason = 'nothing_closed_yet'
    }

    return { last, configured_skus: costs.length, period_days: periodDays, suggested, suggestion_reason: reason }
  }

  /** Read-only: stores nothing and creates no obligation. */
  async preview(dto: ClosingQueryDto, correlationId?: string): Promise<ClosingPreviewView> {
    return (await this.compute(dto, correlationId)).view
  }

  private async compute(dto: ClosingQueryDto, correlationId?: string): Promise<{ view: ClosingPreviewView; cumulative: PreviousClosingTotals | null }> {
    const interval = this.validate(dto)
    const supplier = await this.assertSupplier(dto.supplier_id)
    const empty = { lines: [], total_units: 0, total_cents: 0, configured_skus: 0, skus_without_sales: 0, issues: [], stock: null, removals: null, confirmable: false }
    const head = { supplier_id: supplier.id, supplier_name: supplier.name, period_from: dto.period_from, period_to: dto.period_to, config_missing: [] as Array<'products'>, conflict: null }

    const covered = await this.prisma.settlement.findMany({ where: { supplier_id: dto.supplier_id, state: { in: ['confirmed', 'paid'] } }, select: { id: true, period_start: true, period_end: true, state: true } })
    const hitId = findOverlap(interval, covered.map(r => ({ id: r.id, from: day(r.period_start), until: day(r.period_end) })))
    if (hitId !== null) {
      const hit = covered.find(r => r.id === hitId)!
      const until = day(hit.period_end)

      return { view: { ...head, ...empty, status: 'conflict', conflict: { settlement_id: hit.id, period_from: day(hit.period_start), period_to: addDays(until, -1), state: hit.state, suggested_from: until } }, cumulative: null }
    }

    const costs = await this.costsOf(dto.supplier_id)
    if (costs.length === 0) return { view: { ...head, ...empty, status: 'config_pending', config_missing: ['products'] }, cumulative: null }

    const skus = [...new Set(costs.map(c => c.sku))]
    const sold = await this.sales.soldBySku(dto.period_from, dto.period_to, skus, correlationId)
    if (!sold) throw new ServiceUnavailableException('Sales are unavailable right now: the period could not be calculated')

    const result: Preview = previewClosing({ from: dto.period_from, to: dto.period_to, costs, sales: sold })
    const names = new Map((await this.products.products(correlationId).catch(() => [])).map(p => [p.sku, p.name]))
    const confirmable = result.status === 'ready'

    const months = monthsTouched(dto.period_from, dto.period_to)
    const removed = await this.supply.removals(months[0], months[months.length - 1], skus, correlationId).catch(() => null)
    const previous = removed ? await this.previousTotals(dto.supplier_id) : []
    const cumulative: PreviousClosingTotals | null = removed ? { rows: removed.rows.map(r => ({ period: r.period, sku: r.sku, reason: r.reason, quantity: r.quantity })), months, data_until: removed.data_until ?? {} } : null
    const removals = removed
      ? (() => {
          const view = viewRemovals({ from: dto.period_from, to: dto.period_to, costs, rows: removed.rows, monthsWithData: removed.months_with_data, dataUntil: removed.data_until, previous })

          return { ...view, lines: view.lines.map(l => ({ ...l, name: names.get(l.sku) ?? l.sku })) }
        })()
      : null

    const balances = await this.supply.balances(skus, correlationId).catch(() => null)
    const stock = balances ? viewStock({ from: dto.period_from, to: dto.period_to, skus, balances: balances.rows, sold: new Map(sold.rows.map(r => [r.sku, r.quantity])) }).map(l => ({ ...l, name: names.get(l.sku) ?? l.sku })) : null

    return { view: { ...head, ...result, lines: result.lines.map(l => ({ ...l, name: names.get(l.sku) ?? l.sku })), stock, removals, confirmable }, cumulative }
  }

  /** The month totals each earlier closing of this supplier had when it was confirmed, newest first: what a later closing subtracts to count only what is new. */
  private async previousTotals(supplierId: number): Promise<PreviousClosingTotals[]> {
    const rows = await this.prisma.settlement.findMany({ where: { supplier_id: supplierId, kind: 'closing', state: { in: ['confirmed', 'paid'] } }, orderBy: [{ period_end: 'desc' }, { id: 'desc' }], select: { evidence: true } })

    return rows.map(r => (r.evidence as { removals_cumulative?: PreviousClosingTotals } | null)?.removals_cumulative).filter((c): c is PreviousClosingTotals => Boolean(c))
  }

  /** Recomputes on the server (never trusts the screen) and stores a CONFIRMED closing: this is the only call here that creates an obligation. */
  async confirm(dto: ConfirmClosingDto, correlationId?: string): Promise<SettlementView> {
    const { view, cumulative } = await this.compute(dto, correlationId)
    const onlyAcceptable = view.issues.length > 0 && view.issues.every(i => i.acceptable)
    if (view.status === 'conflict') throw new ConflictException('This period shares days with a settlement already confirmed or paid')
    if (view.status === 'config_pending') throw new BadRequestException('The supplier has no consigned products with an agreed cost yet')
    if (view.status === 'no_sales') throw new BadRequestException('No sales in this period: there is nothing to settle')
    if (view.status === 'incomplete' && !(onlyAcceptable && dto.accept_incomplete === true)) throw new BadRequestException('The period is incomplete: ' + view.issues.map(i => i.code).join(', '))

    const extras = this.pickExtras(view, dto.extras ?? [])
    const homeStock = this.homeStock(view, dto.home_stock ?? [])
    const extrasCents = extras.reduce((sum, e) => sum + e.total_cents, 0)

    const interval = { from: dto.period_from, until: addDays(dto.period_to, 1) }
    try {
      const saved = await this.prisma.settlement.create({
        data: {
          supplier_id: dto.supplier_id,
          week_start: date(interval.from),
          kind: 'closing',
          period_start: date(interval.from),
          period_end: date(interval.until),
          state: 'confirmed',
          owed_cents: view.total_cents + extrasCents,
          partial: view.status === 'incomplete',
          confirmed_at: new Date(),
          evidence: {
            kind: 'closing',
            lines: [],
            soldNotCovered: {},
            quality: { salesUnknown: false, monthsWithoutDatedReceipts: [], storesMissing: Number(view.issues.find(i => i.code === 'stores_missing')?.detail ?? 0) },
            formula: 'devido = unidades vendidas × custo de repasse combinado com o fornecedor (vigente no primeiro dia do período) + as vencidas e outro motivo que a pessoa escolheu pagar',
            source: 'fechamento calculado pelo painel',
            registered_by: dto.actor ?? null,
            closing_lines: view.lines,
            extras,
            stock: view.stock,
            home_stock: homeStock,
            removals_snapshot: view.removals,
            removals_cumulative: cumulative,
          } as never,
        },
        include: { supplier: true },
      })

      return this.settlements.findById(saved.id)
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException(`A settlement of this supplier already starts on ${interval.from}`)
      throw error
    }
  }

  /** The removals the person chose to pay, valued here from the supply data (never from the screen): each one must exist, have units and a cost, and appear once. */
  private pickExtras(view: ClosingPreviewView, wanted: Array<{ sku: string; month: string; kind: 'expired' | 'other_reason' }>) {
    const seen = new Set<string>()
    const out: Array<{ sku: string; name: string; month: string; kind: 'expired' | 'other_reason'; units: number; unit_cost_cents: number; total_cents: number }> = []
    for (const w of wanted) {
      const key = `${w.sku}|${w.month}|${w.kind}`
      if (seen.has(key)) throw new BadRequestException(`${w.sku} ${w.month} ${w.kind} was chosen twice`)
      seen.add(key)
      const scope = view.removals?.scope.find(m => m.month === w.month)
      if (scope && !scope.dated_ok) throw new BadRequestException(`The supply data of ${w.month} goes up to ${scope.data_until}, after the last day of the period: its removals cannot be dated to this period, so they cannot be chosen`)
      const line = view.removals?.lines.find(l => l.sku === w.sku && l.month === w.month)
      const cell = line?.[w.kind]
      if (!line || !cell || cell.units <= 0) throw new BadRequestException(`There are no ${w.kind} units of ${w.sku} in ${w.month} to pay`)
      if (cell.cents === null) throw new BadRequestException(`${w.sku} has no agreed cost: its ${w.kind} units cannot be valued`)
      out.push({ sku: w.sku, name: line.name, month: w.month, kind: w.kind, units: cell.units, unit_cost_cents: cell.cents / cell.units, total_cents: cell.cents })
    }

    return out
  }

  /** Stock at home as the person informed it: only for products of this supplier, once each. */
  private homeStock(view: ClosingPreviewView, wanted: Array<{ sku: string; units: number }>) {
    const names = new Map((view.stock ?? []).map(l => [l.sku, l.name]))
    const seen = new Set<string>()

    return wanted.map(w => {
      if (seen.has(w.sku)) throw new BadRequestException(`Stock at home for ${w.sku} was informed twice`)
      seen.add(w.sku)
      if (!names.has(w.sku)) throw new BadRequestException(`${w.sku} is not a configured product of this supplier`)

      return { sku: w.sku, name: names.get(w.sku) as string, units: w.units }
    })
  }

  private validate(dto: ClosingQueryDto): DayInterval {
    if (!isDay(dto.period_from) || !isDay(dto.period_to)) throw new BadRequestException('period_from and period_to must be real dates, YYYY-MM-DD')
    if (dto.period_to < dto.period_from) throw new BadRequestException('period_to is before period_from')
    if (dto.period_to >= todaySp()) throw new BadRequestException('The period must end on a day that is already over (yesterday at the latest)')

    return { from: dto.period_from, until: addDays(dto.period_to, 1) }
  }

  private async costsOf(supplierId: number): Promise<CostRow[]> {
    const rows = await this.prisma.consignmentCost.findMany({ where: { supplier_id: supplierId }, orderBy: [{ sku: 'asc' }, { valid_from: 'asc' }] })

    return rows.map(c => ({ sku: c.sku, valid_from: day(c.valid_from), unit_cost_cents: c.unit_cost_cents }))
  }

  private async assertSupplier(supplierId: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } })
    if (!supplier) throw new NotFoundException(`Supplier ${supplierId} not found`)

    return supplier
  }
}
