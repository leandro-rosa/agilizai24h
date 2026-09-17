import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { CounterpartyMapping } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import {
  feeCents,
  normalizeCounterparty,
  type Nature,
  type PaymentMethod,
} from '../constants/treasury-vocabulary'
import type {
  BulkUpdateTransactionsDto,
  CashFlowQueryDto,
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
import { computeCashFlow, type CashFlowSummary } from '../utils/cash-flow'

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
  /** Só `kind: revenue`. */
  inflow_cents: number
  /** Só `kind: expense`. */
  outflow_cents: number
  net_cents: number
  by_nature: NatureTotal[]
  by_category: { category: string; outflow_cents: number }[]
  unresolved_count: number
  /** Total de `kind: movement` no período — informativo, nunca somado ao resultado. */
  movement_cents: number
  /** Quantidade e soma de `kind: pending` no período. */
  pending_count: number
  pending_cents: number
}

export interface SupplierTotal {
  supplier_id: number
  outflow_cents: number
  transaction_count: number
}

export interface NeutralizationCandidate {
  a_id: number
  b_id: number
  reason: 'recusado_estornado' | 'devolucao_saida'
  amount_cents: number
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
    if (dto.neutralized_with_id !== undefined) {
      await this.assertNeutralizationTarget(dto.neutralized_with_id, dto.period)
    }

    return this.prisma.bankTransaction.create({
      data: { ...dto, nature: this.natureFor(dto.kind, dto.nature), occurred_on: new Date(dto.occurred_on) },
    })
  }

  async updateTransaction(id: number, dto: UpdateTransactionDto) {
    const existing = await this.prisma.bankTransaction.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Transaction ${id} not found`)

    this.assertInstallmentPair(
      dto.installment_index ?? existing.installment_index ?? undefined,
      dto.installment_total ?? existing.installment_total ?? undefined,
    )
    if (dto.neutralized_with_id !== undefined) {
      await this.assertNeutralizationTarget(dto.neutralized_with_id, dto.period ?? existing.period)
    }

    const kind = dto.kind ?? existing.kind
    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        ...dto,
        // `nature` só faz sentido para `kind: expense` (add-treasury-classification-model D1) —
        // uma correção que muda o kind sem mexer em `nature` não pode deixar um `nature` órfão
        // de uma classificação anterior.
        ...('kind' in dto || 'nature' in dto ? { nature: this.natureFor(kind, dto.nature ?? existing.nature ?? undefined) } : {}),
        ...(dto.occurred_on ? { occurred_on: new Date(dto.occurred_on) } : {}),
      },
    })
  }

  /**
   * Update em lote de `nature`/`category` (seleção múltipla na tela de
   * Lançamentos). `nature` só é gravada nas linhas com `kind: expense` — uma
   * seleção mista (receita+despesa) não pode deixar `nature` órfã numa
   * receita, mesma regra de `updateTransaction`, mas aqui ignora em vez de
   * rejeitar a linha inteira, porque selecionar tipos mistos só pra aplicar
   * categoria em massa é um caso de uso válido.
   */
  async bulkUpdateTransactions(dto: BulkUpdateTransactionsDto): Promise<{ updated: number }> {
    if (dto.nature === undefined && dto.category === undefined) {
      throw new BadRequestException('Informe nature e/ou category para atualizar em lote')
    }

    const rows = await this.prisma.bankTransaction.findMany({
      where: { id: { in: dto.ids } },
      select: { id: true, kind: true },
    })
    if (rows.length === 0) throw new NotFoundException('Nenhum lançamento encontrado para os ids informados')

    const results = await this.prisma.$transaction(
      rows.map(row =>
        this.prisma.bankTransaction.update({
          where: { id: row.id },
          data: {
            ...(dto.category !== undefined ? { category: dto.category } : {}),
            ...(dto.nature !== undefined && row.kind === 'expense' ? { nature: dto.nature } : {}),
          },
        }),
      ),
    )
    return { updated: results.length }
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
    // Um par neutralizado nunca entra em total nenhum (nem receita/despesa,
    // nem movimentação, nem pendente) — continua visível em listTransactions
    // para auditoria, só não neste resumo (add-treasury-classification-model).
    const where = { ...this.transactionWhere(filter), neutralized_with_id: null }

    const [rows, unresolved] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        select: { direction: true, amount_cents: true, nature: true, category: true, period: true, kind: true },
      }),
      this.prisma.bankTransaction.count({ where: { ...where, supplier_id: null } }),
    ])

    const natures = new Map<string, NatureTotal>()
    const categories = new Map<string, number>()
    let inflow = 0
    let outflow = 0
    let movement = 0
    let pendingCount = 0
    let pendingCents = 0
    let periodFrom = ''
    let periodTo = ''

    for (const row of rows) {
      if (!periodFrom || row.period < periodFrom) periodFrom = row.period
      if (!periodTo || row.period > periodTo) periodTo = row.period

      // `movement`/`pending` nunca entram em receita, despesa, natureza ou
      // categoria — só nos próprios contadores informativos.
      if (row.kind === 'movement') {
        movement += row.amount_cents
        continue
      }
      if (row.kind === 'pending') {
        pendingCount += 1
        pendingCents += row.amount_cents
        continue
      }

      const isInflow = row.direction === 'inflow'
      if (isInflow) inflow += row.amount_cents
      else outflow += row.amount_cents

      if (row.nature) {
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
      }

      if (!isInflow) categories.set(row.category, (categories.get(row.category) ?? 0) + row.amount_cents)
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
      movement_cents: movement,
      pending_count: pendingCount,
      pending_cents: pendingCents,
    }
  }

  /**
   * Fluxo de caixa em regime de caixa — mesma tabela de `summary()`, mas por
   * `occurred_on` (data real) em vez de `period` (competência), e com saldo
   * de verdade (toda linha, qualquer `kind`) em vez de só receita/despesa.
   * Ver `computeCashFlow` pra a regra completa de o que entra em Entradas/
   * Saídas vs. saldo. `neutralized_with_id: null` nas duas queries, mesma
   * regra de `summary()`/`transactionsBySupplier()` — um par neutralizado
   * nunca entra em total nenhum.
   *
   * Gap conhecido, não escondido (documentado também na tela — ver
   * `frontend/apps/admin/.../finance/cash-flow/page.tsx`): `opening_balance_cents`
   * assume saldo zero antes do primeiro `bank_transaction` importado da
   * conta. Períodos que dependem de um mês sem extrato importado (ver
   * lacunas conhecidas no CLAUDE.md deste serviço) vêm com saldo inicial
   * incorreto — não há como resolver sem o extrato que falta ou uma âncora
   * de saldo manual, que não existe nesta fase.
   */
  async cashFlow(filter: CashFlowQueryDto): Promise<CashFlowSummary> {
    const from = new Date(filter.occurred_from)
    const to = new Date(filter.occurred_to)
    const accountId = filter.account_id ?? null

    const openingRows = await this.prisma.bankTransaction.groupBy({
      by: ['direction'],
      where: {
        occurred_on: { lt: from },
        neutralized_with_id: null,
        ...(accountId !== null ? { account_id: accountId } : {}),
      },
      _sum: { amount_cents: true },
    })
    const openingInflow = openingRows.find(r => r.direction === 'inflow')?._sum.amount_cents ?? 0
    const openingOutflow = openingRows.find(r => r.direction === 'outflow')?._sum.amount_cents ?? 0

    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        occurred_on: { gte: from, lte: to },
        neutralized_with_id: null,
        ...(accountId !== null ? { account_id: accountId } : {}),
      },
      select: { occurred_on: true, direction: true, amount_cents: true, category: true },
    })

    return computeCashFlow(
      filter.occurred_from,
      filter.occurred_to,
      accountId,
      openingInflow - openingOutflow,
      rows.map(r => ({
        occurred_on: r.occurred_on.toISOString().slice(0, 10),
        direction: r.direction as 'inflow' | 'outflow',
        amount_cents: r.amount_cents,
        category: r.category,
      })),
    )
  }

  /**
   * Soma de despesa por fornecedor, cruzando todas as contas do período —
   * nunca uma linha por conta (add-treasury-classification-model).
   */
  async transactionsBySupplier(period: string): Promise<SupplierTotal[]> {
    const rows = await this.prisma.bankTransaction.groupBy({
      by: ['supplier_id'],
      where: { period, kind: 'expense', supplier_id: { not: null }, neutralized_with_id: null },
      _sum: { amount_cents: true },
      _count: { _all: true },
    })

    return rows
      .filter((row): row is typeof row & { supplier_id: number } => row.supplier_id !== null)
      .map(row => ({
        supplier_id: row.supplier_id,
        outflow_cents: row._sum.amount_cents ?? 0,
        transaction_count: row._count._all,
      }))
      .sort((a, b) => b.outflow_cents - a.outflow_cents)
  }

  /**
   * Categorias em uso — a lista seedada mais qualquer categoria que uma
   * regra de de-para já tenha introduzido, para a UI oferecer como sugestão
   * sem precisar de migration a cada categoria nova.
   */
  async listCategories(): Promise<string[]> {
    const [fromTransactions, fromMappings] = await Promise.all([
      this.prisma.bankTransaction.findMany({ distinct: ['category'], select: { category: true } }),
      this.prisma.counterpartyMapping.findMany({ distinct: ['category'], select: { category: true } }),
    ])

    return [...new Set([...fromTransactions, ...fromMappings].map(row => row.category))].sort()
  }

  /**
   * Sugestões de par a neutralizar — nunca vincula sozinho (add-treasury-
   * classification-model D6). Duas formas: (a) saída e entrada de mesmo
   * valor, mesmo dia, mesma conta (Pix recusado/estornado); (b) uma entrada
   * batendo com uma saída recente ao mesmo fornecedor resolvido, mesmo valor
   * (devolução). Sempre dentro do mesmo período.
   */
  async neutralizationCandidates(period: string): Promise<NeutralizationCandidate[]> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: { period, neutralized_with_id: null },
      select: {
        id: true,
        account_id: true,
        occurred_on: true,
        direction: true,
        amount_cents: true,
        supplier_id: true,
      },
    })

    const candidates: NeutralizationCandidate[] = []
    const used = new Set<number>()

    const outflows = rows.filter(row => row.direction === 'outflow')
    const inflows = rows.filter(row => row.direction === 'inflow')

    // (a) mesmo valor, mesmo dia, mesma conta, sentidos opostos.
    for (const outflow of outflows) {
      if (used.has(outflow.id)) continue
      const match = inflows.find(
        inflow =>
          !used.has(inflow.id) &&
          inflow.account_id === outflow.account_id &&
          inflow.amount_cents === outflow.amount_cents &&
          inflow.occurred_on.getTime() === outflow.occurred_on.getTime(),
      )
      if (match) {
        candidates.push({ a_id: outflow.id, b_id: match.id, reason: 'recusado_estornado', amount_cents: outflow.amount_cents })
        used.add(outflow.id)
        used.add(match.id)
      }
    }

    // (b) entrada batendo com saída recente ao mesmo fornecedor resolvido.
    for (const inflow of inflows) {
      if (used.has(inflow.id) || inflow.supplier_id === null) continue
      const match = outflows.find(
        outflow =>
          !used.has(outflow.id) &&
          outflow.supplier_id === inflow.supplier_id &&
          outflow.amount_cents === inflow.amount_cents &&
          outflow.occurred_on.getTime() <= inflow.occurred_on.getTime(),
      )
      if (match) {
        candidates.push({ a_id: match.id, b_id: inflow.id, reason: 'devolucao_saida', amount_cents: inflow.amount_cents })
        used.add(match.id)
        used.add(inflow.id)
      }
    }

    return candidates
  }

  /** Vincula um par como neutralizado — precisa de confirmação humana explícita, nunca automático. */
  async neutralize(aId: number, bId: number): Promise<void> {
    if (aId === bId) throw new BadRequestException('Um lançamento não neutraliza a si mesmo')

    const [a, b] = await Promise.all([
      this.prisma.bankTransaction.findUnique({ where: { id: aId } }),
      this.prisma.bankTransaction.findUnique({ where: { id: bId } }),
    ])
    if (!a) throw new NotFoundException(`Transaction ${aId} not found`)
    if (!b) throw new NotFoundException(`Transaction ${bId} not found`)
    if (a.neutralized_with_id !== null || b.neutralized_with_id !== null) {
      throw new ConflictException('Um dos dois lançamentos já está neutralizado por outro')
    }
    if (a.period !== b.period) {
      throw new BadRequestException('Neutralização só entre lançamentos do mesmo período')
    }

    await this.prisma.$transaction([
      this.prisma.bankTransaction.update({ where: { id: aId }, data: { neutralized_with_id: bId } }),
      this.prisma.bankTransaction.update({ where: { id: bId }, data: { neutralized_with_id: aId } }),
    ])
  }

  /** Desfaz um par neutralizado — a confirmação anterior não é permanente se se mostrar errada. */
  async unneutralize(id: number): Promise<void> {
    const transaction = await this.prisma.bankTransaction.findUnique({ where: { id } })
    if (!transaction) throw new NotFoundException(`Transaction ${id} not found`)
    if (transaction.neutralized_with_id === null) return

    const otherId = transaction.neutralized_with_id
    await this.prisma.$transaction([
      this.prisma.bankTransaction.update({ where: { id }, data: { neutralized_with_id: null } }),
      this.prisma.bankTransaction.update({ where: { id: otherId }, data: { neutralized_with_id: null } }),
    ])
  }

  // ----- DE-PARA ------------------------------------------------------------

  listMappings() {
    return this.prisma.counterpartyMapping.findMany({ orderBy: [{ display_name: 'asc' }, { id: 'asc' }] })
  }

  async createMapping(dto: CreateMappingDto) {
    // `contains` também é normalizado: a palavra-chave precisa bater com o
    // mesmo dobramento (caixa/acento) que `resolveMapping` aplica ao texto
    // do lançamento, senão "posto" nunca bateria com "POSTO IPIRANGA".
    const matchText = normalizeCounterparty(dto.match_text)
    if (!matchText) throw new BadRequestException('match_text vazio depois de normalizado')

    const owner = await this.prisma.counterpartyMapping.findUnique({ where: { match_text: matchText } })
    if (owner) {
      throw new ConflictException(`"${dto.match_text}" já é mapeado pela regra ${owner.id}`)
    }

    const kind = dto.kind ?? 'expense'
    return this.prisma.counterpartyMapping.create({
      data: { ...dto, match_text: matchText, kind, nature: this.natureFor(kind, dto.nature) },
    })
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

    const kind = dto.kind ?? existing.kind
    return this.prisma.counterpartyMapping.update({
      where: { id },
      data: {
        ...dto,
        ...(matchText ? { match_text: matchText } : {}),
        ...('kind' in dto || 'nature' in dto
          ? { kind, nature: this.natureFor(kind, dto.nature ?? existing.nature ?? undefined) }
          : {}),
      },
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
   * Só toca `kind: pending` — o sinal real de "ainda não classificado" desde
   * add-treasury-classification-model. Antes disso o critério era
   * `supplier_id: null`, mas isso também é verdade para todo lançamento
   * `movement` já classificado corretamente (uma transferência entre contas
   * próprias nunca tem fornecedor) — reaplicar em cima dele reprocessaria
   * (inofensivo) ou, pior, desfaria uma correção manual que trocasse o kind
   * sem mexer no fornecedor. `kind: pending` é o único estado que
   * genuinamente significa "ninguém classificou isto ainda".
   */
  async applyMappings(period: string): Promise<{ examined: number; classified: number }> {
    const pending = await this.prisma.bankTransaction.findMany({
      where: { period, kind: 'pending' },
      select: { id: true, counterparty_raw: true },
    })
    if (pending.length === 0) return { examined: 0, classified: 0 }

    const resolved = await this.resolveMany(pending.map(t => t.counterparty_raw))

    let classified = 0
    for (const transaction of pending) {
      const rule = resolved.get(normalizeCounterparty(transaction.counterparty_raw))
      if (!rule) continue

      await this.prisma.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          kind: rule.kind,
          supplier_id: rule.supplier_id,
          entry_type: rule.entry_type,
          category: rule.category,
          nature: this.natureFor(rule.kind, rule.nature ?? undefined),
        },
      })
      classified += 1
    }

    return { examined: pending.length, classified }
  }

  /**
   * Batch resolution: exact match first, then the longest matching
   * `contains` rule (design "Risks" — a more specific keyword must beat a
   * more general one). Shared by `applyMappings` and, from
   * add-treasury-statement-ingestion, `PendingImportService` — one
   * resolution algorithm, never re-implemented per caller.
   *
   * Keyed by NORMALIZED text: callers with a raw, unnormalized string should
   * key their own lookups through `normalizeCounterparty` too.
   */
  async resolveMany(counterpartyRawTexts: string[]): Promise<Map<string, CounterpartyMapping>> {
    const normalizedKeys = [...new Set(counterpartyRawTexts.map(normalizeCounterparty).filter(Boolean))]
    const result = new Map<string, CounterpartyMapping>()
    if (normalizedKeys.length === 0) return result

    const [exactRules, containsRules] = await Promise.all([
      this.prisma.counterpartyMapping.findMany({
        where: { match_type: 'exact', match_text: { in: normalizedKeys } },
      }),
      this.prisma.counterpartyMapping.findMany({ where: { match_type: 'contains' } }),
    ])
    const exactByKey = new Map(exactRules.map(rule => [rule.match_text, rule]))

    for (const key of normalizedKeys) {
      const rule = exactByKey.get(key) ?? this.longestContainsMatch(key, containsRules)
      if (rule) result.set(key, rule)
    }

    return result
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
      ...(filter.occurred_from || filter.occurred_to
        ? {
            occurred_on: {
              ...(filter.occurred_from ? { gte: new Date(filter.occurred_from) } : {}),
              ...(filter.occurred_to ? { lte: new Date(filter.occurred_to) } : {}),
            },
          }
        : {}),
      ...(filter.account_id !== undefined ? { account_id: filter.account_id } : {}),
      ...(filter.nature !== undefined ? { nature: filter.nature as Nature } : {}),
      ...(filter.kind !== undefined ? { kind: filter.kind } : {}),
      ...(filter.direction !== undefined ? { direction: filter.direction } : {}),
      ...(filter.store_id !== undefined ? { store_id: filter.store_id } : {}),
      ...(filter.supplier_id !== undefined ? { supplier_id: filter.supplier_id } : {}),
      ...(filter.unresolved ? { supplier_id: null } : {}),
    }
  }

  /** `nature` só existe para `kind: expense` — todo outro kind grava `null` (design D1). */
  natureFor(kind: string, nature?: string | null): string | null {
    return kind === 'expense' ? (nature ?? null) : null
  }

  /**
   * Entre as regras `contains` cujo texto aparece no favorecido normalizado,
   * a de `match_text` mais longo vence — uma palavra-chave mais específica
   * deve bater antes de uma mais genérica (design "Risks").
   */
  private longestContainsMatch(
    normalized: string,
    rules: CounterpartyMapping[],
  ): CounterpartyMapping | undefined {
    return rules
      .filter(rule => normalized.includes(rule.match_text))
      .reduce<CounterpartyMapping | undefined>(
        (longest, rule) => (!longest || rule.match_text.length > longest.match_text.length ? rule : longest),
        undefined,
      )
  }

  /** Neutralização é sempre dentro do mesmo período — nunca olha meses anteriores (design D6/D7 escopo). */
  private async assertNeutralizationTarget(targetId: number, period: string): Promise<void> {
    const target = await this.prisma.bankTransaction.findUnique({ where: { id: targetId } })
    if (!target) throw new NotFoundException(`Transaction ${targetId} not found`)
    if (target.period !== period) {
      throw new BadRequestException(
        `neutralized_with_id ${targetId} está no período ${target.period}, não ${period} — neutralização é só dentro do mesmo mês`,
      )
    }
  }
}
