import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import {
  feeCents,
  normalizeCounterparty,
  type Nature,
  type PaymentMethod,
} from '../constants/treasury-vocabulary'
import type {
  CreateAccountDto,
  CreateFeeDto,
  CreateMappingDto,
  CreateTransactionDto,
  ListTransactionsDto,
  UpdateAccountDto,
  UpdateMappingDto,
  UpdateTransactionDto,
  UpsertSettlementDto,
} from '../dto/treasury.dto'

export interface NatureTotal {
  nature: string
  inflow_cents: number
  outflow_cents: number
  net_cents: number
}

export interface TransactionSummary {
  period_from: string
  period_to: string
  transaction_count: number
  inflow_cents: number
  outflow_cents: number
  net_cents: number
  by_nature: NatureTotal[]
  by_category: { category: string; outflow_cents: number }[]
  unresolved_count: number
}

@Injectable()
export class TreasuryService {
  constructor(private readonly prisma: PrismaClientService) {}

  // ----- contas -------------------------------------------------------------

  listAccounts() {
    return this.prisma.bankAccount.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] })
  }

  createAccount(dto: CreateAccountDto) {
    return this.prisma.bankAccount.create({ data: { ...dto, status: 'active' } })
  }

  async updateAccount(id: number, dto: UpdateAccountDto) {
    await this.getAccount(id)
    return this.prisma.bankAccount.update({ where: { id }, data: dto })
  }

  // ----- lançamentos --------------------------------------------------------

  async createTransaction(dto: CreateTransactionDto) {
    await this.getAccount(dto.account_id)
    this.assertInstallmentPair(dto.installment_index, dto.installment_total)

    return this.prisma.bankTransaction.create({
      data: { ...dto, occurred_on: new Date(dto.occurred_on) },
    })
  }

  async updateTransaction(id: number, dto: UpdateTransactionDto) {
    const existing = await this.prisma.bankTransaction.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Transaction ${id} not found`)

    this.assertInstallmentPair(
      dto.installment_index ?? existing.installment_index ?? undefined,
      dto.installment_total ?? existing.installment_total ?? undefined,
    )

    return this.prisma.bankTransaction.update({
      where: { id },
      data: { ...dto, ...(dto.occurred_on ? { occurred_on: new Date(dto.occurred_on) } : {}) },
    })
  }

  async deleteTransaction(id: number): Promise<void> {
    const existing = await this.prisma.bankTransaction.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Transaction ${id} not found`)

    // Diferente de loja e fornecedor, um lançamento PODE ser excluído: ele é
    // um fato de extrato, e um fato lançado errado precisa sair, não virar
    // "inativo" somando no DRE para sempre.
    await this.prisma.bankTransaction.delete({ where: { id } })
  }

  listTransactions(filter: ListTransactionsDto) {
    return this.prisma.bankTransaction.findMany({
      where: this.transactionWhere(filter),
      orderBy: [{ occurred_on: 'desc' }, { id: 'desc' }],
    })
  }

  /**
   * Totais do período por natureza e por categoria.
   *
   * Existe para a tela de fluxo de caixa não puxar milhares de linhas só para
   * somar no cliente — e para `unresolved_count` ficar visível: lançamento sem
   * fornecedor resolvido é trabalho pendente, não detalhe.
   */
  async summary(filter: ListTransactionsDto): Promise<TransactionSummary> {
    const where = this.transactionWhere(filter)

    const [rows, unresolved] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        select: { direction: true, amount_cents: true, nature: true, category: true, period: true },
      }),
      this.prisma.bankTransaction.count({ where: { ...where, supplier_id: null } }),
    ])

    const natures = new Map<string, NatureTotal>()
    const categories = new Map<string, number>()
    let inflow = 0
    let outflow = 0
    let periodFrom = ''
    let periodTo = ''

    for (const row of rows) {
      const isInflow = row.direction === 'inflow'
      if (isInflow) inflow += row.amount_cents
      else outflow += row.amount_cents

      const nature = natures.get(row.nature) ?? {
        nature: row.nature,
        inflow_cents: 0,
        outflow_cents: 0,
        net_cents: 0,
      }
      if (isInflow) nature.inflow_cents += row.amount_cents
      else nature.outflow_cents += row.amount_cents
      nature.net_cents = nature.inflow_cents - nature.outflow_cents
      natures.set(row.nature, nature)

      if (!isInflow) categories.set(row.category, (categories.get(row.category) ?? 0) + row.amount_cents)

      if (!periodFrom || row.period < periodFrom) periodFrom = row.period
      if (!periodTo || row.period > periodTo) periodTo = row.period
    }

    return {
      period_from: periodFrom,
      period_to: periodTo,
      transaction_count: rows.length,
      inflow_cents: inflow,
      outflow_cents: outflow,
      net_cents: inflow - outflow,
      by_nature: [...natures.values()].sort((a, b) => b.outflow_cents - a.outflow_cents),
      by_category: [...categories.entries()]
        .map(([category, outflow_cents]) => ({ category, outflow_cents }))
        .sort((a, b) => b.outflow_cents - a.outflow_cents),
      unresolved_count: unresolved,
    }
  }

  // ----- DE-PARA ------------------------------------------------------------

  listMappings() {
    return this.prisma.counterpartyMapping.findMany({ orderBy: [{ display_name: 'asc' }, { id: 'asc' }] })
  }

  async createMapping(dto: CreateMappingDto) {
    const matchText = normalizeCounterparty(dto.match_text)
    if (!matchText) throw new BadRequestException('match_text vazio depois de normalizado')

    const owner = await this.prisma.counterpartyMapping.findUnique({ where: { match_text: matchText } })
    if (owner) {
      throw new ConflictException(`"${dto.match_text}" já é mapeado pela regra ${owner.id}`)
    }

    return this.prisma.counterpartyMapping.create({ data: { ...dto, match_text: matchText } })
  }

  async updateMapping(id: number, dto: UpdateMappingDto) {
    const existing = await this.prisma.counterpartyMapping.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Mapping ${id} not found`)

    const matchText = dto.match_text ? normalizeCounterparty(dto.match_text) : undefined
    if (matchText) {
      const owner = await this.prisma.counterpartyMapping.findUnique({ where: { match_text: matchText } })
      if (owner && owner.id !== id) {
        throw new ConflictException(`"${dto.match_text}" já é mapeado pela regra ${owner.id}`)
      }
    }

    return this.prisma.counterpartyMapping.update({
      where: { id },
      data: { ...dto, ...(matchText ? { match_text: matchText } : {}) },
    })
  }

  async deleteMapping(id: number): Promise<void> {
    const existing = await this.prisma.counterpartyMapping.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Mapping ${id} not found`)

    await this.prisma.counterpartyMapping.delete({ where: { id } })
  }

  /**
   * Classifica lançamentos ainda não classificados aplicando o DE-PARA.
   *
   * Só toca o que está sem `supplier_id`: reaplicar sobre lançamento já
   * conferido à mão desfaria a correção de quem conciliou.
   */
  async applyMappings(period: string): Promise<{ examined: number; classified: number }> {
    const pending = await this.prisma.bankTransaction.findMany({
      where: { period, supplier_id: null },
      select: { id: true, counterparty_raw: true },
    })
    if (pending.length === 0) return { examined: 0, classified: 0 }

    const keys = [...new Set(pending.map(t => normalizeCounterparty(t.counterparty_raw)))]
    const mappings = await this.prisma.counterpartyMapping.findMany({
      where: { match_text: { in: keys } },
    })
    const byKey = new Map(mappings.map(m => [m.match_text, m]))

    let classified = 0
    for (const transaction of pending) {
      const rule = byKey.get(normalizeCounterparty(transaction.counterparty_raw))
      if (!rule) continue

      await this.prisma.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          supplier_id: rule.supplier_id,
          entry_type: rule.entry_type,
          category: rule.category,
          nature: rule.nature,
        },
      })
      classified += 1
    }

    return { examined: pending.length, classified }
  }

  // ----- taxas de adquirente ------------------------------------------------

  listFees() {
    return this.prisma.acquirerFee.findMany({
      orderBy: [{ acquirer: 'asc' }, { payment_method: 'asc' }, { effective_from: 'desc' }],
    })
  }

  createFee(dto: CreateFeeDto) {
    return this.prisma.acquirerFee.create({
      data: { ...dto, effective_from: new Date(dto.effective_from) },
    })
  }

  /** A taxa vigente naquela data — nunca "a taxa atual" sem data. */
  async effectiveFee(acquirer: string, method: PaymentMethod, on: Date): Promise<number | null> {
    const fee = await this.prisma.acquirerFee.findFirst({
      where: { acquirer, payment_method: method, effective_from: { lte: on } },
      orderBy: { effective_from: 'desc' },
    })

    return fee?.rate_bps ?? null
  }

  // ----- liquidação ---------------------------------------------------------

  listSettlements(period?: string) {
    return this.prisma.settlementReceipt.findMany({
      where: period ? { period } : {},
      orderBy: [{ period: 'desc' }, { payment_method: 'asc' }],
    })
  }

  /**
   * Grava o recebido por meio de pagamento. Se `fee_cents` não vier, deriva
   * da taxa vigente na liquidação — mas nunca sobrescreve um valor informado:
   * o extrato do adquirente é mais autoritativo que a tabela de taxa.
   */
  async upsertSettlement(dto: UpsertSettlementDto, acquirer = 'PagSeguro') {
    const settledOn = dto.settled_on ? new Date(dto.settled_on) : null

    let fee = dto.fee_cents
    if (fee === undefined) {
      const rate = await this.effectiveFee(acquirer, dto.payment_method, settledOn ?? new Date())
      if (rate === null) {
        throw new BadRequestException(
          `Sem taxa cadastrada para ${acquirer}/${dto.payment_method} — informe fee_cents ou cadastre a taxa`,
        )
      }
      fee = feeCents(dto.gross_cents, rate)
    }

    const data = {
      store_id: dto.store_id ?? null,
      period: dto.period,
      payment_method: dto.payment_method,
      gross_cents: dto.gross_cents,
      fee_cents: fee,
      net_cents: dto.gross_cents - fee,
      settled_on: settledOn,
    }

    // `upsert` não endereça chave composta com coluna nula, e o consolidado
    // da rede tem `store_id` nulo. Find-then-write numa transação; a corrida
    // é barrada pelo índice único parcial da migration, não por este código.
    return this.prisma.$transaction(async tx => {
      const existing = await tx.settlementReceipt.findFirst({
        where: { store_id: data.store_id, period: data.period, payment_method: data.payment_method },
      })

      return existing
        ? tx.settlementReceipt.update({ where: { id: existing.id }, data })
        : tx.settlementReceipt.create({ data })
    })
  }

  // ----- privados -----------------------------------------------------------

  private async getAccount(id: number) {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } })
    if (!account) throw new NotFoundException(`Account ${id} not found`)

    return account
  }

  private assertInstallmentPair(index?: number, total?: number): void {
    // Parcela 3 sem total, ou total sem índice, é dado meio lançado — e vira
    // uma fatura que não fecha. Os dois juntos ou nenhum.
    if ((index === undefined) !== (total === undefined)) {
      throw new BadRequestException('installment_index e installment_total vêm juntos ou nenhum dos dois')
    }
    if (index !== undefined && total !== undefined && index > total) {
      throw new BadRequestException(`installment_index ${index} maior que installment_total ${total}`)
    }
  }

  private transactionWhere(filter: ListTransactionsDto) {
    const period =
      filter.period !== undefined
        ? { period: filter.period }
        : filter.from || filter.to
          ? { period: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
          : {}

    return {
      ...period,
      ...(filter.account_id !== undefined ? { account_id: filter.account_id } : {}),
      ...(filter.nature !== undefined ? { nature: filter.nature as Nature } : {}),
      ...(filter.direction !== undefined ? { direction: filter.direction } : {}),
      ...(filter.store_id !== undefined ? { store_id: filter.store_id } : {}),
      ...(filter.supplier_id !== undefined ? { supplier_id: filter.supplier_id } : {}),
      ...(filter.unresolved ? { supplier_id: null } : {}),
    }
  }
}
