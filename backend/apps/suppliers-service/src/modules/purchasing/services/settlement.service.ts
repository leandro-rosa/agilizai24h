import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { SalesClient } from '../clients/sales.client'
import type { SettlementState } from '../constants/purchase-vocabulary'
import type { LegacySettlementDto } from '../dto/legacy-settlement.dto'
import type { ProposeSettlementDto } from '../dto/settlement.dto'
import { legacyEvidence, legacyInterval, validateLegacy } from '../utils/legacy-settlement'
import { computeSettlement, type OnSaleItem, type PriorLine, type SettlementLine, type WriteOff } from '../utils/settlement'
import { findOverlap, lastDay, weekInterval, type DayInterval } from '../utils/settlement-coverage'
import { addDays, isDay, weekStartOf } from '../utils/week'

export interface SettlementEvidence {
  lines: SettlementLine[]
  soldNotCovered: Record<string, number>
  quality: {
    /** No dated receipts for the week: the sold units are unknown, so nothing was counted as owed. */
    salesUnknown: boolean
    monthsWithoutDatedReceipts: string[]
    storesMissing: number
  }
  /** `owed = sold × unit cost`, shown with the numbers so the amount can be checked. */
  formula: string
  /** Só no acerto histórico (`kind = 'legacy'`): de onde veio e as linhas da planilha. `lines` fica vazio nele. */
  kind?: 'legacy'
  source?: string
  registered_by?: string | null
  legacy_lines?: Array<{ name: string; sku: string | null; unit_cost_cents: number; quantity: number; total_cents: number }>
}

export interface SettlementView {
  id: number
  supplier_id: number
  supplier_name: string | null
  week_start: string
  week_end: string
  kind: 'regular' | 'legacy'
  /** Primeiro e último dia cobertos, ambos inclusos (dias de São Paulo). */
  period_from: string
  period_to: string
  state: SettlementState
  /** A proposal is not owed yet: only a confirmed settlement counts. */
  counts_as_owed: boolean
  owed_cents: number
  partial: boolean
  evidence: SettlementEvidence
  confirmed_at: string | null
  paid_on: string | null
  payment_note: string | null
}

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)

type Row = {
  id: number
  supplier_id: number
  week_start: Date
  kind: string
  period_start: Date
  period_end: Date
  state: string
  owed_cents: number
  partial: boolean
  evidence: unknown
  confirmed_at: Date | null
  paid_on: Date | null
  payment_note: string | null
  supplier?: { name: string } | null
}

function toView(row: Row): SettlementView {
  const start = day(row.week_start) as string

  return {
    id: row.id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier?.name ?? null,
    week_start: start,
    week_end: lastDay({ from: day(row.period_start) as string, until: day(row.period_end) as string }),
    kind: row.kind as 'regular' | 'legacy',
    period_from: day(row.period_start) as string,
    period_to: lastDay({ from: day(row.period_start) as string, until: day(row.period_end) as string }),
    state: row.state as SettlementState,
    counts_as_owed: row.state !== 'proposal',
    owed_cents: row.owed_cents,
    partial: row.partial,
    evidence: row.evidence as SettlementEvidence,
    confirmed_at: row.confirmed_at?.toISOString() ?? null,
    paid_on: day(row.paid_on),
    payment_note: row.payment_note,
  }
}

/** The days a proposal covers: the chosen first..last day (both included), or the Monday-to-Sunday week of `week_start`. */
function proposalInterval(dto: ProposeSettlementDto): DayInterval {
  if (dto.period_from || dto.period_to) {
    if (!dto.period_from || !dto.period_to) throw new BadRequestException('period_from and period_to go together')
    if (!isDay(dto.period_from) || !isDay(dto.period_to)) throw new BadRequestException('period_from and period_to must be real dates, YYYY-MM-DD')
    if (dto.period_to < dto.period_from) throw new BadRequestException('period_to is before period_from')

    return { from: dto.period_from, until: addDays(dto.period_to, 1) }
  }
  if (!dto.week_start || !isDay(dto.week_start)) throw new BadRequestException('week_start must be a real date, YYYY-MM-DD')

  return weekInterval(weekStartOf(dto.week_start))
}

@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly sales: SalesClient,
  ) {}

  /**
   * Computes the week of a supplier's on-sale items and stores it as a PROPOSAL (recomputing replaces an earlier proposal;
   * a confirmed or paid week is final). Owed = units sold × unit cost; sold comes from the dated receipts. A week without
   * dated receipts owes nothing and says why — it is partial, never silently cheaper.
   */
  async propose(dto: ProposeSettlementDto, correlationId?: string): Promise<SettlementView> {
    const interval = proposalInterval(dto)

    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplier_id } })
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplier_id} not found`)

    const weekStart = interval.from
    const from = interval.from
    const to = lastDay(interval)
    const weekDate = new Date(`${weekStart}T00:00:00Z`)

    const existing = await this.prisma.settlement.findUnique({ where: { supplier_id_week_start: { supplier_id: dto.supplier_id, week_start: weekDate } } })
    if (existing && existing.state !== 'proposal') throw new ConflictException(`The week of ${weekStart} is already ${existing.state}: it can no longer be recomputed`)
    await this.assertNoCoveredOverlap(dto.supplier_id, interval)

    // Delivered means RECEIVED: an order still waiting for receipt is not part of any settlement, and what counts is the received quantity.
    const purchases = await this.prisma.purchase.findMany({
      where: { supplier_id: dto.supplier_id, status: 'received', received_on: { lte: new Date(`${to}T00:00:00Z`) } },
      include: { items: { where: { condition: 'on_sale' } } },
    })
    const items: OnSaleItem[] = purchases.flatMap(p =>
      p.items.map(i => ({ itemId: i.id, deliveredOn: day(p.received_on ?? p.ordered_on) as string, sku: i.sku, quantity: i.received_quantity ?? i.quantity, unitCostCents: i.unit_cost_cents })),
    )
    if (items.length === 0) throw new BadRequestException('This supplier has no on-sale items received up to that week')

    const prior = await this.priorLines(dto.supplier_id, weekDate)
    const writeOffs: WriteOff[] = (dto.write_offs ?? []).map(w => ({ itemId: w.item_id, expired: w.expired ?? 0, returned: w.returned ?? 0 }))
    const known = new Set(items.map(i => i.itemId))
    const stray = writeOffs.filter(w => !known.has(w.itemId)).map(w => w.itemId)
    if (stray.length > 0) throw new BadRequestException(`Write-offs for items that are not on sale for this supplier: ${stray.join(', ')}`)

    const skus = [...new Set(items.map(i => i.sku))]
    const sold = await this.sales.soldBySku(from, to, skus, correlationId)
    const salesUnknown = !sold || sold.months_without_dated_receipts.length > 0
    // Without dated receipts the sold units are unknown: count none rather than guess, and flag it.
    const soldBySku = new Map<string, number>(salesUnknown ? [] : sold!.rows.map(r => [r.sku, r.quantity]))

    const result = computeSettlement({ items, soldBySku, writeOffs, prior })
    const quality = { salesUnknown, monthsWithoutDatedReceipts: sold?.months_without_dated_receipts ?? [], storesMissing: sold?.stores_missing ?? 0 }
    const partial = salesUnknown || quality.storesMissing > 0
    const evidence: SettlementEvidence = {
      lines: result.lines,
      soldNotCovered: result.soldNotCovered,
      quality,
      formula: 'devido = unidades vendidas × custo unitário; vencidas, devolvidas e sem vender não são devidas',
    }

    const periodEnd = new Date(`${interval.until}T00:00:00Z`)
    const saved = await this.prisma.settlement.upsert({
      where: { supplier_id_week_start: { supplier_id: dto.supplier_id, week_start: weekDate } },
      create: { supplier_id: dto.supplier_id, week_start: weekDate, period_start: weekDate, period_end: periodEnd, state: 'proposal', owed_cents: result.owedCents, partial, evidence: evidence as never },
      update: { owed_cents: result.owedCents, partial, evidence: evidence as never },
      include: { supplier: true },
    })

    return toView(saved)
  }

  async confirm(id: number, acceptPartial = false): Promise<SettlementView> {
    const row = await this.get(id)
    if (row.state !== 'proposal') throw new ConflictException(`Settlement ${id} is already ${row.state}`)
    if (row.partial && !acceptPartial) throw new ConflictException('This week is partial (missing dated receipts or stores): confirm only with accept_partial, taking the number as it is')

    await this.assertNoCoveredOverlap(row.supplier_id, { from: day(row.period_start) as string, until: day(row.period_end) as string }, id)

    const updated = await this.prisma.settlement.update({ where: { id }, data: { state: 'confirmed', confirmed_at: new Date() }, include: { supplier: true } })

    return toView(updated)
  }

  async markPaid(id: number, paidOn?: string, note?: string): Promise<SettlementView> {
    const row = await this.get(id)
    if (row.state !== 'confirmed') throw new ConflictException(row.state === 'paid' ? `Settlement ${id} is already paid` : 'Only a confirmed settlement can be marked paid')
    if (paidOn && !isDay(paidOn)) throw new BadRequestException('paid_on must be a real date, YYYY-MM-DD')

    const updated = await this.prisma.settlement.update({
      where: { id },
      data: { state: 'paid', paid_on: new Date(`${paidOn ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`), payment_note: note },
      include: { supplier: true },
    })

    return toView(updated)
  }

  async list(filter: { supplierId?: number; state?: SettlementState } = {}): Promise<SettlementView[]> {
    const rows = await this.prisma.settlement.findMany({
      where: { ...(filter.supplierId ? { supplier_id: filter.supplierId } : {}), ...(filter.state ? { state: filter.state } : {}) },
      include: { supplier: true },
      orderBy: [{ week_start: 'desc' }, { id: 'desc' }],
      take: 200,
    })

    return rows.map(toView)
  }

  async findById(id: number): Promise<SettlementView> {
    return toView(await this.get(id))
  }

  /** What is owed and unpaid: confirmed settlements only (a proposal is not owed). */
  async openTotal(): Promise<{ confirmed_cents: number; proposals: number }> {
    const rows = await this.prisma.settlement.findMany({ where: { state: { in: ['confirmed', 'proposal'] } }, select: { state: true, owed_cents: true } })

    return { confirmed_cents: rows.filter(r => r.state === 'confirmed').reduce((s, r) => s + r.owed_cents, 0), proposals: rows.filter(r => r.state === 'proposal').length }
  }

  /**
   * Registers a settlement made outside the system (the spreadsheet): already paid, covering the selected days. It never enters the running balance
   * of regular settlements; its days can never be covered again by another confirmed or paid settlement of the supplier.
   */
  async registerLegacy(dto: LegacySettlementDto): Promise<SettlementView> {
    const problems = validateLegacy(dto)
    if (problems.length > 0) throw new BadRequestException(problems.join('; '))

    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplier_id } })
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplier_id} not found`)

    const interval = legacyInterval(dto)
    await this.assertNoCoveredOverlap(dto.supplier_id, interval)

    const date = (value: string) => new Date(`${value}T00:00:00Z`)
    try {
      const saved = await this.prisma.settlement.create({
        data: {
          supplier_id: dto.supplier_id,
          week_start: date(interval.from),
          period_start: date(interval.from),
          period_end: date(interval.until),
          kind: 'legacy',
          state: 'paid',
          owed_cents: dto.total_cents,
          partial: false,
          evidence: legacyEvidence(dto) as never,
          confirmed_at: date(dto.paid_on),
          paid_on: date(dto.paid_on),
          payment_note: dto.note,
        },
        include: { supplier: true },
      })

      return toView(saved)
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException(`A settlement of this supplier already starts on ${interval.from}`)
      throw error
    }
  }

  /** The most recent confirmed or paid settlement (a proposal is not a settlement yet), by the last day it covers. */
  async last(supplierId: number): Promise<SettlementView | null> {
    const row = await this.prisma.settlement.findFirst({
      where: { supplier_id: supplierId, state: { in: ['confirmed', 'paid'] } },
      orderBy: [{ period_end: 'desc' }, { id: 'desc' }],
      include: { supplier: true },
    })

    return row ? toView(row) : null
  }

  /** No new settlement may cover a day that another confirmed or paid settlement of the same supplier already covers. */
  private async assertNoCoveredOverlap(supplierId: number, interval: DayInterval, exceptId?: number): Promise<void> {
    const rows = await this.prisma.settlement.findMany({
      where: { supplier_id: supplierId, state: { in: ['confirmed', 'paid'] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, period_start: true, period_end: true },
    })
    const hit = findOverlap(interval, rows.map(r => ({ id: r.id, from: day(r.period_start) as string, until: day(r.period_end) as string })))
    if (hit !== null) throw new ConflictException(`Days from ${interval.from} are already covered by settlement ${hit}: the same sales cannot be settled twice`)
  }

  private async get(id: number) {
    const row = await this.prisma.settlement.findUnique({ where: { id }, include: { supplier: true } })
    if (!row) throw new NotFoundException(`Settlement ${id} not found`)

    return row
  }

  /** Units already owed or written off by CONFIRMED (or paid) earlier weeks, per item. */
  private async priorLines(supplierId: number, before: Date): Promise<PriorLine[]> {
    const rows = await this.prisma.settlement.findMany({
      where: { supplier_id: supplierId, kind: 'regular', state: { in: ['confirmed', 'paid'] }, week_start: { lt: before } },
      select: { evidence: true },
    })
    const byItem = new Map<number, PriorLine>()
    for (const row of rows)
      for (const line of ((row.evidence as { lines?: SettlementLine[] } | null)?.lines ?? [])) {
        const acc = byItem.get(line.itemId) ?? { itemId: line.itemId, owedUnits: 0, writtenOffUnits: 0 }
        acc.owedUnits += line.owedUnits
        acc.writtenOffUnits += line.expired + line.returned
        byItem.set(line.itemId, acc)
      }

    return [...byItem.values()]
  }
}
