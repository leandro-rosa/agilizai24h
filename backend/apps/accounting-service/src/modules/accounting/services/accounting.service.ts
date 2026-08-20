import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import {
  computePnl,
  PNL_SECTIONS,
  type PnlInput,
  type Section,
} from '../constants/accounting-vocabulary'
import type {
  CreateAccountDto,
  ListEntriesDto,
  PutEntryDto,
  UpdateAccountDto,
  UpsertCashFlowDto,
} from '../dto/accounting.dto'

export interface AccountNode {
  id: number
  code: string
  label: string
  section: string
  sign: number
  per_store: boolean
  sort_order: number
  amount_cents: number
  origin: string | null
  children: AccountNode[]
}

export interface PnlView {
  period: string
  store_id: number | null
  status: string
  totals: ReturnType<typeof computePnl> & { gross_revenue_cents: number; store_count: number }
  sections: { section: string; amount_cents: number; accounts: AccountNode[] }[]
}

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaClientService) {}

  // ----- plano de contas ----------------------------------------------------

  listAccounts(statement?: string) {
    return this.prisma.account.findMany({
      where: statement ? { statement } : {},
      orderBy: [{ statement: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
    })
  }

  async createAccount(dto: CreateAccountDto) {
    const taken = await this.prisma.account.findUnique({ where: { code: dto.code } })
    if (taken) throw new ConflictException(`Código ${dto.code} já existe (conta ${taken.id})`)

    if (dto.parent_id) await this.getAccount(dto.parent_id)

    return this.prisma.account.create({ data: dto })
  }

  async updateAccount(id: number, dto: UpdateAccountDto) {
    await this.getAccount(id)

    if (dto.parent_id === id) {
      throw new BadRequestException('Uma conta não pode ser mãe de si mesma')
    }
    if (dto.code) {
      const taken = await this.prisma.account.findUnique({ where: { code: dto.code } })
      if (taken && taken.id !== id) throw new ConflictException(`Código ${dto.code} já existe`)
    }

    return this.prisma.account.update({ where: { id }, data: dto })
  }

  // ----- lançamentos --------------------------------------------------------

  /**
   * Idempotente por (conta, período, loja): relançar o mesmo mês substitui,
   * não duplica. É o que permite reprocessar um período sem limpar antes —
   * o caminho pelo qual a planilha acumula linha repetida.
   */
  async putEntry(dto: PutEntryDto) {
    await this.getAccount(dto.account_id)

    const key = {
      account_id: dto.account_id,
      period: dto.period,
      store_id: dto.store_id ?? null,
    }
    const data = { ...key, amount_cents: dto.amount_cents, origin: dto.origin ?? 'manual', source_ref: dto.source_ref }

    // `upsert` não endereça uma chave composta com coluna nula, e a linha da
    // rede tem `store_id` nulo. Find-then-write numa transação; a corrida é
    // barrada pelo índice único parcial da migration, não por este código.
    return this.prisma.$transaction(async tx => {
      const existing = await tx.ledgerEntry.findFirst({ where: key })

      return existing
        ? tx.ledgerEntry.update({ where: { id: existing.id }, data })
        : tx.ledgerEntry.create({ data })
    })
  }

  async deleteEntry(id: number): Promise<void> {
    const existing = await this.prisma.ledgerEntry.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Entry ${id} not found`)

    await this.prisma.ledgerEntry.delete({ where: { id } })
  }

  listEntries(filter: ListEntriesDto) {
    return this.prisma.ledgerEntry.findMany({
      where: {
        ...this.periodWhere(filter),
        ...(filter.store_id !== undefined ? { store_id: filter.store_id } : {}),
        ...(filter.statement ? { account: { statement: filter.statement } } : {}),
      },
      include: { account: true },
      orderBy: [{ period: 'asc' }, { account: { sort_order: 'asc' } }],
    })
  }

  // ----- DRE ----------------------------------------------------------------

  /**
   * Monta a árvore do DRE com os valores do período.
   *
   * `store_id` ausente devolve a rede — e a rede é lida dos lançamentos com
   * `store_id` nulo MAIS a soma dos lançamentos por loja. Somar os dois é
   * deliberado: a planilha tem linhas que só existem consolidadas (contador,
   * pró-labore) e linhas que só existem por loja (venda), e o DRE da rede
   * precisa das duas.
   */
  async pnl(period: string, storeId?: number): Promise<PnlView> {
    const accounts = await this.prisma.account.findMany({
      where: { statement: 'pnl' },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    })
    if (accounts.length === 0) {
      throw new NotFoundException('Plano de contas vazio — rode o seed do plano antes de apurar')
    }

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { period, ...(storeId !== undefined ? { store_id: storeId } : {}) },
    })

    const amounts = new Map<number, number>()
    const origins = new Map<number, string>()
    for (const entry of entries) {
      amounts.set(entry.account_id, (amounts.get(entry.account_id) ?? 0) + entry.amount_cents)
      origins.set(entry.account_id, entry.origin)
    }

    const nodes = new Map<number, AccountNode>()
    for (const account of accounts) {
      nodes.set(account.id, {
        id: account.id,
        code: account.code,
        label: account.label,
        section: account.section,
        sign: account.sign,
        per_store: account.per_store,
        sort_order: account.sort_order,
        amount_cents: amounts.get(account.id) ?? 0,
        origin: origins.get(account.id) ?? null,
        children: [],
      })
    }

    const roots: AccountNode[] = []
    for (const account of accounts) {
      const node = nodes.get(account.id)!
      const parent = account.parent_id ? nodes.get(account.parent_id) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }

    // Uma conta-mãe soma as filhas quando não tem valor próprio. Escrito
    // assim, e não "sempre soma", porque a planilha tem linhas de total
    // lançadas à mão que não devem ser sobrescritas por uma soma parcial.
    const rollUp = (node: AccountNode): number => {
      const childSum = node.children.reduce((sum, child) => sum + rollUp(child), 0)
      if (node.children.length > 0 && node.amount_cents === 0) node.amount_cents = childSum
      return node.amount_cents
    }
    roots.forEach(rollUp)

    const bySection = new Map<string, number>()
    const sectionAccounts = new Map<string, AccountNode[]>()
    for (const node of roots) {
      bySection.set(node.section, (bySection.get(node.section) ?? 0) + node.amount_cents)
      sectionAccounts.set(node.section, [...(sectionAccounts.get(node.section) ?? []), node])
    }

    const sectionTotal = (section: Section) => bySection.get(section) ?? 0
    const input: PnlInput = {
      gross_revenue_cents: sectionTotal('gross_revenue'),
      deductions_cents: sectionTotal('deductions'),
      cogs_cents: sectionTotal('cogs'),
      variable_expenses_cents: sectionTotal('variable_expenses'),
      fixed_expenses_cents: sectionTotal('fixed_expenses'),
      financial_expenses_cents: sectionTotal('financial_expenses'),
    }

    const snapshot = await this.prisma.pnlSnapshot.findFirst({
      where: { period, store_id: storeId ?? null },
    })

    return {
      period,
      store_id: storeId ?? null,
      status: snapshot?.status ?? 'open',
      totals: {
        ...computePnl(input),
        gross_revenue_cents: input.gross_revenue_cents,
        store_count: snapshot?.store_count ?? 0,
      },
      sections: PNL_SECTIONS.map(section => ({
        section,
        amount_cents: sectionTotal(section),
        accounts: sectionAccounts.get(section) ?? [],
      })),
    }
  }

  /** Congela o mês. Um DRE fechado não muda quando alguém corrige o passado. */
  async computeSnapshot(period: string, storeId: number | undefined, storeCount: number, close = false) {
    const view = await this.pnl(period, storeId)
    const t = view.totals

    const data = {
      period,
      store_id: storeId ?? null,
      status: close ? 'closed' : 'open',
      store_count: storeCount,
      gross_revenue_cents: t.gross_revenue_cents,
      deductions_cents: t.gross_revenue_cents - t.net_revenue_cents,
      net_revenue_cents: t.net_revenue_cents,
      cogs_cents: t.net_revenue_cents - t.gross_profit_cents,
      gross_profit_cents: t.gross_profit_cents,
      variable_expenses_cents: t.gross_profit_cents - t.contribution_margin_cents,
      contribution_margin_cents: t.contribution_margin_cents,
      fixed_expenses_cents: t.contribution_margin_cents - t.ebitda_cents,
      ebitda_cents: t.ebitda_cents,
      financial_expenses_cents: t.ebitda_cents - t.operating_profit_cents,
      operating_profit_cents: t.operating_profit_cents,
      break_even_cents: t.break_even_cents,
      safety_margin_bps: t.safety_margin_bps,
      computed_at: new Date(),
    }

    return this.prisma.$transaction(async tx => {
      const existing = await tx.pnlSnapshot.findFirst({ where: { period, store_id: storeId ?? null } })

      return existing
        ? tx.pnlSnapshot.update({ where: { id: existing.id }, data })
        : tx.pnlSnapshot.create({ data })
    })
  }

  listSnapshots(from?: string, to?: string, storeId?: number) {
    return this.prisma.pnlSnapshot.findMany({
      where: {
        ...(from || to ? { period: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        store_id: storeId ?? null,
      },
      orderBy: { period: 'asc' },
    })
  }

  // ----- fluxo de caixa -----------------------------------------------------

  async upsertCashFlow(dto: UpsertCashFlowDto) {
    const closing =
      dto.opening_balance_cents + dto.receipts_cents - dto.opex_cents - dto.loan_payments_cents - dto.capex_cents

    const data = { ...dto, closing_balance_cents: closing, computed_at: new Date() }

    return this.prisma.cashFlowSnapshot.upsert({
      where: { period: dto.period },
      create: data,
      update: data,
    })
  }

  listCashFlow(from?: string, to?: string) {
    return this.prisma.cashFlowSnapshot.findMany({
      where: from || to ? { period: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
      orderBy: { period: 'asc' },
    })
  }

  // ----- privados -----------------------------------------------------------

  private async getAccount(id: number) {
    const account = await this.prisma.account.findUnique({ where: { id } })
    if (!account) throw new NotFoundException(`Account ${id} not found`)

    return account
  }

  private periodWhere(filter: ListEntriesDto) {
    if (filter.period !== undefined) return { period: filter.period }
    if (filter.from || filter.to) {
      return { period: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
    }
    return {}
  }
}
