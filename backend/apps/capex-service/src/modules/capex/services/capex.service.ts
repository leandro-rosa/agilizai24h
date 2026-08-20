import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { itemCostCents, paybackMonths } from '../constants/capex-vocabulary'
import type {
  CreateContributionDto,
  CreateInvestorDto,
  CreateItemDto,
  UpdateInvestorDto,
  UpdateItemDto,
  UpsertStoreInvestmentDto,
} from '../dto/capex.dto'

export interface PaybackRow {
  store_id: number
  total_invested_cents: number
  monthly_revenue_cents: number
  monthly_profit_cents: number
  /// null = indefinido. Nenhum número de meses paga uma loja sem lucro.
  payback_months: number | null
}

export interface InvestorSummaryRow {
  investor_id: number
  name: string
  committed_amount_cents: number
  contributed_amount_cents: number
  /// Coluna "DIF. INVESTIMENTO" da planilha.
  difference_cents: number
  contribution_count: number
}

@Injectable()
export class CapexService {
  constructor(private readonly prisma: PrismaClientService) {}

  // ----- investimento por loja ----------------------------------------------

  listInvestments() {
    return this.prisma.storeInvestment.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: [{ store_id: 'asc' }],
    })
  }

  async findInvestment(storeId: number) {
    const investment = await this.prisma.storeInvestment.findUnique({
      where: { store_id: storeId },
      include: { items: { orderBy: [{ purchased_on: 'asc' }, { id: 'asc' }] } },
    })
    if (!investment) throw new NotFoundException(`Store ${storeId} has no investment recorded`)

    return investment
  }

  async upsertInvestment(dto: UpsertStoreInvestmentDto) {
    const existing = await this.prisma.storeInvestment.findUnique({ where: { store_id: dto.store_id } })
    const investment = existing
      ? await this.prisma.storeInvestment.update({ where: { store_id: dto.store_id }, data: dto })
      : await this.prisma.storeInvestment.create({ data: dto })

    return this.recompute(investment.store_id)
  }

  /**
   * Re-soma os itens e re-deriva o payback.
   *
   * Chamado depois de toda escrita de item: `total_invested_cents` é
   * materializado para a tela de payback não re-somar 24 lojas por request, e
   * um total materializado que não é recalculado vira mentira silenciosa.
   */
  async recompute(storeId: number) {
    const investment = await this.prisma.storeInvestment.findUnique({
      where: { store_id: storeId },
      include: { items: true },
    })
    if (!investment) throw new NotFoundException(`Store ${storeId} has no investment recorded`)

    const total = investment.items.reduce((sum, item) => sum + itemCostCents(item) * item.quantity, 0)
    const payback = paybackMonths(total, investment.monthly_profit_cents)

    return this.prisma.storeInvestment.update({
      where: { store_id: storeId },
      data: {
        total_invested_cents: total,
        payback_months: payback,
        computed_at: new Date(),
      },
      include: { items: { orderBy: [{ purchased_on: 'asc' }, { id: 'asc' }] } },
    })
  }

  /** Payback por loja, das que se pagam mais rápido para as que não se pagam. */
  async payback(): Promise<PaybackRow[]> {
    const rows = await this.prisma.storeInvestment.findMany({ orderBy: { store_id: 'asc' } })

    return rows
      .map(row => ({
        store_id: row.store_id,
        total_invested_cents: row.total_invested_cents,
        monthly_revenue_cents: row.monthly_revenue_cents,
        monthly_profit_cents: row.monthly_profit_cents,
        payback_months: row.payback_months === null ? null : Number(row.payback_months),
      }))
      .sort((a, b) => {
        // Indefinido vai para o fim: é o caso que precisa de atenção, e
        // ordenar como se fosse zero o colocaria em primeiro, no lugar da
        // loja que realmente se paga mais rápido.
        if (a.payback_months === null) return 1
        if (b.payback_months === null) return -1
        return a.payback_months - b.payback_months
      })
  }

  // ----- itens --------------------------------------------------------------

  listItems(storeId?: number, category?: string) {
    return this.prisma.investmentItem.findMany({
      where: {
        ...(storeId !== undefined ? { store_investment: { store_id: storeId } } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: [{ purchased_on: 'desc' }, { id: 'desc' }],
    })
  }

  async createItem(dto: CreateItemDto) {
    const { store_id: storeId, ...rest } = dto
    const investmentId = storeId === undefined ? null : (await this.ensureInvestment(storeId)).id

    const item = await this.prisma.investmentItem.create({
      data: { ...rest, purchased_on: new Date(dto.purchased_on), store_investment_id: investmentId },
    })

    if (storeId !== undefined) await this.recompute(storeId)

    return item
  }

  async updateItem(id: number, dto: UpdateItemDto) {
    const existing = await this.prisma.investmentItem.findUnique({
      where: { id },
      include: { store_investment: true },
    })
    if (!existing) throw new NotFoundException(`Item ${id} not found`)

    const { store_id: storeId, ...rest } = dto
    const investmentId =
      storeId === undefined ? existing.store_investment_id : (await this.ensureInvestment(storeId)).id

    const item = await this.prisma.investmentItem.update({
      where: { id },
      data: {
        ...rest,
        ...(dto.purchased_on ? { purchased_on: new Date(dto.purchased_on) } : {}),
        store_investment_id: investmentId,
      },
    })

    // Recalcula os dois lados quando o item muda de loja, senão o total da
    // loja antiga fica com o item que ela não tem mais.
    if (existing.store_investment) await this.recompute(existing.store_investment.store_id)
    if (storeId !== undefined && storeId !== existing.store_investment?.store_id) await this.recompute(storeId)

    return item
  }

  async deleteItem(id: number): Promise<void> {
    const existing = await this.prisma.investmentItem.findUnique({
      where: { id },
      include: { store_investment: true },
    })
    if (!existing) throw new NotFoundException(`Item ${id} not found`)

    await this.prisma.investmentItem.delete({ where: { id } })

    if (existing.store_investment) await this.recompute(existing.store_investment.store_id)
  }

  // ----- investidores -------------------------------------------------------

  listInvestors() {
    return this.prisma.investor.findMany({
      include: { _count: { select: { contributions: true } } },
      orderBy: [{ name: 'asc' }],
    })
  }

  async findInvestor(id: number) {
    const investor = await this.prisma.investor.findUnique({
      where: { id },
      include: { contributions: { orderBy: { contributed_on: 'asc' } } },
    })
    if (!investor) throw new NotFoundException(`Investor ${id} not found`)

    return investor
  }

  createInvestor(dto: CreateInvestorDto) {
    return this.prisma.investor.create({ data: dto })
  }

  async updateInvestor(id: number, dto: UpdateInvestorDto) {
    await this.findInvestor(id)

    return this.prisma.investor.update({ where: { id }, data: dto })
  }

  async addContribution(investorId: number, dto: CreateContributionDto) {
    await this.findInvestor(investorId)

    return this.prisma.investorContribution.create({
      data: { ...dto, investor_id: investorId, contributed_on: new Date(dto.contributed_on) },
    })
  }

  async deleteContribution(investorId: number, contributionId: number): Promise<void> {
    const contribution = await this.prisma.investorContribution.findUnique({ where: { id: contributionId } })
    if (!contribution || contribution.investor_id !== investorId) {
      throw new NotFoundException(`Contribution ${contributionId} not found for investor ${investorId}`)
    }

    await this.prisma.investorContribution.delete({ where: { id: contributionId } })
  }

  /** Comprometido vs. aportado — a coluna "DIF. INVESTIMENTO" da planilha. */
  async investorSummary(): Promise<InvestorSummaryRow[]> {
    const investors = await this.prisma.investor.findMany({
      include: { contributions: { select: { amount_cents: true } } },
      orderBy: { name: 'asc' },
    })

    return investors.map(investor => {
      const contributed = investor.contributions.reduce((sum, c) => sum + c.amount_cents, 0)

      return {
        investor_id: investor.id,
        name: investor.name,
        committed_amount_cents: investor.committed_amount_cents,
        contributed_amount_cents: contributed,
        difference_cents: investor.committed_amount_cents - contributed,
        contribution_count: investor.contributions.length,
      }
    })
  }

  // ----- privados -----------------------------------------------------------

  private async ensureInvestment(storeId: number) {
    const existing = await this.prisma.storeInvestment.findUnique({ where: { store_id: storeId } })

    return existing ?? this.prisma.storeInvestment.create({ data: { store_id: storeId } })
  }
}
