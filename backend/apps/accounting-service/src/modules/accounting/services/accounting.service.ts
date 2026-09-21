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
  /**
   * Verdadeiro quando este valor não é um lançamento real desta loja, mas
   * uma estimativa por rateio (participação na receita) de um custo só
   * lançado a nível de rede — ver `pnl()`. Nunca confundir com `origin`,
   * que descreve a proveniência de um lançamento real.
   */
  allocated: boolean
  children: AccountNode[]
}

export interface PnlView {
  period: string
  store_id: number | null
  status: string
  totals: ReturnType<typeof computePnl> & { gross_revenue_cents: number; store_count: number }
  sections: { section: string; amount_cents: number; accounts: AccountNode[] }[]
}

/** Uma linha do painel "Lojas" (`GET /accounting/pnl/:period/by-store`) — resumo enxuto para tabela, não a árvore inteira. */
export interface StorePnlSummary {
  store_id: number
  gross_revenue_cents: number
  net_revenue_cents: number
  cogs_cents: number
  contribution_margin_cents: number
  operating_profit_cents: number
  mensalidade_cents: number
  perdas_cents: number
  /** Soma de tudo marcado `allocated: true` nesta loja — a coluna "Rateio" da planilha do operador. */
  allocated_cents: number
  /**
   * Resultado usando só o que é FATO desta loja (nenhum item `allocated:
   * true` contado) — pedido do operador 2026-09-18: uma loja pode ser
   * operacionalmente saudável e ainda assim não conseguir absorver sua
   * fatia da estrutura. Comparar com `operating_profit_cents` (depois do
   * rateio) é o que revela essa diferença.
   */
  operating_profit_before_allocation_cents: number
  /**
   * Soma só do pacote administrativo de rede (`EQUAL_SPLIT_CODES` —
   * contador, pró-labore, sistema Touchpay, ERP, juros, marketing,
   * degustações) — pedido do operador 2026-09-18, filtro "Sem rateio ×
   * Com rateio" do painel "Lojas". Diferente de `allocated_cents`: NÃO
   * inclui Deslocamento nem Repasse de vendas, porque esses dois são custo
   * real da própria loja (driver de visita/receita), não estrutura
   * administrativa — a distinção que separa "operação da loja" de
   * "estrutura da empresa".
   */
  admin_allocated_cents: number
  /** `contribution_margin_cents` somado de volta o pedaço do pacote administrativo que mora dentro de despesas variáveis (Degustações/Marketing) — a "Margem de contribuição" da visão Sem rateio. */
  contribution_margin_excl_admin_cents: number
  /** `operating_profit_cents` somado de volta `admin_allocated_cents` — o "Resultado operacional" da visão Sem rateio: conta Deslocamento/Repasse (custo real da loja), não conta estrutura administrativa de rede. */
  operating_profit_excl_admin_cents: number
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

    // Coffee break e Frutas (3.1.04/3.1.05) são um serviço à parte do
    // minimercado — pedido do operador 2026-09-18: não entram no resultado
    // de UMA loja, só no consolidado da rede. O lançamento real continua
    // existindo (não apagado), só não aparece numa consulta por loja.
    if (storeId !== undefined) {
      const excluded = new Set(
        accounts.filter(a => a.code === '3.1.04' || a.code === '3.1.05').map(a => a.id),
      )
      for (const accountId of excluded) amounts.delete(accountId)
    }

    const allocatedAccountIds = await this.allocateNetworkCostsToStore(period, storeId, accounts, amounts)

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
        allocated: allocatedAccountIds.has(account.id),
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
      if (node.children.length > 0 && node.amount_cents === 0) {
        node.amount_cents = childSum
        // O valor da mãe é só a soma das filhas (não um lançamento próprio) —
        // se alguma filha for rateio, a mãe também é, senão o total de
        // "Deslocamento" pareceria fato quando é soma de estimativa.
        node.allocated = node.children.some(child => child.allocated)
      }
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

  /**
   * Todas as lojas com receita real no período, lado a lado — o painel
   * "Lojas" (pedido do operador 2026-09-18: uma visão geral pra analisar e
   * decidir sobre lojas individualmente, não só uma de cada vez). Reusa
   * `pnl()` por loja (mesmo cálculo, mesmo rateio) em vez de duplicar
   * lógica — gap conhecido "sem DRE por loja em lote" do CLAUDE.md, fechado
   * aqui só para leitura resumida (`computeSnapshot`/fechar mês continua
   * uma chamada por loja, de propósito, já que fechar é escrita).
   */
  async pnlByStore(period: string): Promise<StorePnlSummary[]> {
    const revenueAccounts = await this.prisma.account.findMany({
      where: { statement: 'pnl', section: 'gross_revenue' },
    })
    const revenueAccountIds = revenueAccounts.map(a => a.id)

    const storeRows = await this.prisma.ledgerEntry.findMany({
      where: { period, store_id: { not: null }, account_id: { in: revenueAccountIds } },
      distinct: ['store_id'],
      select: { store_id: true },
    })
    const storeIds = storeRows.map(r => r.store_id!).sort((a, b) => a - b)

    const findByCode = (node: AccountNode, code: string): AccountNode | undefined => {
      if (node.code === code) return node
      for (const child of node.children) {
        const found = findByCode(child, code)
        if (found) return found
      }
      return undefined
    }
    const sumAllocated = (node: AccountNode): number =>
      (node.allocated && node.children.length === 0 ? node.amount_cents : 0) +
      node.children.reduce((sum, child) => sum + sumAllocated(child), 0)

    // Só o pacote administrativo (EQUAL_SPLIT_CODES) dentro do que está
    // alocado — Deslocamento/Repasse ficam de fora mesmo sendo `allocated`,
    // porque não são estrutura de rede, são custo real da loja com driver
    // próprio. `sectionFilter` isola só a fatia que mora em despesas
    // variáveis (Degustações/Marketing), a única que afeta margem de
    // contribuição — o resto (Sistema/Contador/Pró-labore/ERP/Juros) só
    // afeta o resultado final.
    const sumAdmin = (node: AccountNode, sectionFilter?: string): number =>
      (node.allocated &&
      node.children.length === 0 &&
      AccountingService.EQUAL_SPLIT_CODES.has(node.code) &&
      (!sectionFilter || node.section === sectionFilter)
        ? node.amount_cents
        : 0) + node.children.reduce((sum, child) => sum + sumAdmin(child, sectionFilter), 0)

    // Só as folhas contam — uma conta-mãe (Deslocamento) é só a soma das
    // filhas, contá-la também dobraria o valor.
    const sumRealBySection = (node: AccountNode, section: string, acc: Map<string, number>): void => {
      if (node.children.length === 0) {
        if (!node.allocated) acc.set(section, (acc.get(section) ?? 0) + node.amount_cents)
        return
      }
      for (const child of node.children) sumRealBySection(child, section, acc)
    }

    const summaries: StorePnlSummary[] = []
    for (const storeId of storeIds) {
      const view = await this.pnl(period, storeId)
      const allAccounts = view.sections.flatMap(s => s.accounts)
      const mensalidade = allAccounts.map(a => findByCode(a, '3.1.03')).find(Boolean)
      const perdas = allAccounts.map(a => findByCode(a, '4.2.02')).find(Boolean)
      const cogs = view.sections.find(s => s.section === 'cogs')?.amount_cents ?? 0
      const allocatedTotal = allAccounts.reduce((sum, a) => sum + sumAllocated(a), 0)
      const adminAllocatedTotal = allAccounts.reduce((sum, a) => sum + sumAdmin(a), 0)
      const adminVariableTotal = allAccounts.reduce((sum, a) => sum + sumAdmin(a, 'variable_expenses'), 0)

      const bySectionReal = new Map<string, number>()
      for (const section of view.sections) {
        for (const account of section.accounts) sumRealBySection(account, section.section, bySectionReal)
      }
      const realInput: PnlInput = {
        gross_revenue_cents: bySectionReal.get('gross_revenue') ?? 0,
        deductions_cents: bySectionReal.get('deductions') ?? 0,
        cogs_cents: bySectionReal.get('cogs') ?? 0,
        variable_expenses_cents: bySectionReal.get('variable_expenses') ?? 0,
        fixed_expenses_cents: bySectionReal.get('fixed_expenses') ?? 0,
        financial_expenses_cents: bySectionReal.get('financial_expenses') ?? 0,
      }

      summaries.push({
        store_id: storeId,
        gross_revenue_cents: view.totals.gross_revenue_cents,
        net_revenue_cents: view.totals.net_revenue_cents,
        cogs_cents: cogs,
        contribution_margin_cents: view.totals.contribution_margin_cents,
        operating_profit_cents: view.totals.operating_profit_cents,
        mensalidade_cents: mensalidade?.amount_cents ?? 0,
        perdas_cents: perdas?.amount_cents ?? 0,
        allocated_cents: allocatedTotal,
        operating_profit_before_allocation_cents: computePnl(realInput).operating_profit_cents,
        admin_allocated_cents: adminAllocatedTotal,
        contribution_margin_excl_admin_cents: view.totals.contribution_margin_cents + adminVariableTotal,
        operating_profit_excl_admin_cents: view.totals.operating_profit_cents + adminAllocatedTotal,
      })
    }

    return summaries
  }

  /**
   * Deslocamento (Gasolina/Pedágio/Alimentação) — o custo é da ROTA de
   * abastecimento, não da receita da loja: uma loja pequena visitada toda
   * semana consome tanto combustível/pedágio pra chegar nela quanto uma
   * grande. `StoreVisitCount` é o nº real de visitas (sincronizado de
   * `ingestion_operation`, ver o model) — driver real, não estimativa.
   */
  private static readonly VISIT_DRIVEN_CODES = new Set(['4.2.04', '4.2.05', '4.2.08'])

  /**
   * Sistema Touchpay (mensalidade de plataforma, por terminal/loja) e, por
   * pedido do operador 2026-09-18, o restante do custo administrativo que
   * não tem driver de loja nenhum (contador, pró-labore, ERP Conta Azul,
   * juros de empréstimo, marketing, degustações) — revisão da decisão
   * anterior de deixá-los só na rede: sem incluir esse bloco, "Margem
   * operacional" por loja nunca vira um "Resultado" final comparável entre
   * lojas para decisão de manter/fechar/renegociar. Dividido igualmente
   * entre as lojas com movimento real no período (uma loja sem `Vendas
   * lojas` lançada nesse mês não conta — não tinha operação ativa).
   */
  private static readonly EQUAL_SPLIT_CODES = new Set([
    '4.3.01', // Sistema Touchpay
    '4.3.02', // Contador
    '4.3.03', // Pró-labore
    '4.3.05', // ERP Conta Azul
    '4.4.01', // Juros de empréstimo
    '4.2.06', // Degustações
    '4.2.07', // Marketing
  ])

  /**
   * Impostos sobre a venda — Simples Nacional é literalmente % da receita
   * bruta da REDE INTEIRA, não é convenção. Participação na receita de rede
   * é o driver correto aqui.
   */
  private static readonly REVENUE_DRIVEN_CODES = new Set(['3.2.01'])

  /**
   * As 5 lojas Plena Saúde (operador 2026-09-18): não têm mensalidade,
   * pagam 5% de repasse sobre a própria venda em vez disso — Ascenty e
   * Rolls-Royce nunca têm repasse nenhum.
   */
  private static readonly PLENA_SAUDE_STORE_IDS = new Set([16, 17, 18, 19, 20])

  /**
   * Repasse de vendas: NÃO é rateio de um total de rede — é 5% sobre a
   * venda da PRÓPRIA loja, direto (operador 2026-09-18, corrigindo a
   * versão anterior deste comentário). Confirmado com um valor real: Franco
   * da Rocha em agosto/2026 teve repasse de R$773,72, exatamente 5% dos
   * R$15.474,58 de venda da própria loja (bate ao centavo, a diferença de
   * R$0,01 é arredondamento). O total real transferido pela Plena Saúde
   * (nível de rede, fato de extrato) não precisa bater com a soma dos 5%
   * de cada loja — os dois convivem: a rede mostra o fato, cada loja
   * mostra a fórmula contratual dela.
   */
  private static readonly PLENA_SAUDE_FLAT_RATE_CODES = new Set(['4.2.01'])
  private static readonly PLENA_SAUDE_REPASSE_RATE = 0.05

  /**
   * Rateio por driver real de custo — pedido do operador 2026-09-18, revisto
   * depois de uma primeira versão que ratava TUDO por receita e sobrecarregava
   * loja pequena com custo que não tem relação com o que ela gera (ver
   * `store-unit-economics.md` da skill `autonomous-retail-cfo`: deslocamento e
   * sistema SÃO custo de loja, só que com driver próprio — não vira
   * "corporativo" só porque o extrato não discrimina por loja).
   *
   * Cada conta é rateada por NO MÁXIMO um driver, escolhido por código —
   * `VISIT_DRIVEN_CODES`/`EQUAL_SPLIT_CODES`/`REVENUE_DRIVEN_CODES` acima.
   * Uma conta de rede que não está em nenhuma das três listas (qualquer
   * categoria futura sem driver óbvio) fica só na rede — rateio é opt-in por
   * conta, nunca automático, porque "sem driver conhecido" deve significar
   * "não estimar", não "ratear por padrão".
   *
   * Muta `amounts` em vez de devolver um mapa novo, e devolve só os ids
   * alocados — é `pnl()` quem já tem a estrutura de `amounts`/`origins`
   * pronta para os nós da árvore, inclusive o roll-up de conta-mãe logo
   * depois.
   *
   * Nunca grava `LedgerEntry` nenhum: cada leitura recalcula do zero contra
   * o dado real do período, e o resultado é marcado `allocated: true` — a
   * mesma distinção FATO/PREMISSA que `origin` já faz para lançamento real,
   * só que aqui é ESTIMATIVA por definição, nunca confundível com fato.
   *
   * Receita nunca é rateada — cada loja já tem a própria (`sales-service`).
   * Uma conta com lançamento real desta loja (`amounts.has(accountId)`)
   * também nunca é sobrescrita pelo rateio, mesmo que a conta também tenha
   * um valor de rede — o real sempre vence a estimativa.
   */
  private async allocateNetworkCostsToStore(
    period: string,
    storeId: number | undefined,
    accounts: { id: number; code: string; section: string }[],
    amounts: Map<number, number>,
  ): Promise<Set<number>> {
    const allocated = new Set<number>()
    if (storeId === undefined) return allocated

    const revenueAccountIds = new Set(accounts.filter(a => a.section === 'gross_revenue').map(a => a.id))
    const codeById = new Map(accounts.map(a => [a.id, a.code]))

    const [networkEntries, allRevenueEntries, visitCounts] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { period, store_id: null } }),
      // Base do rateio por receita: a REDE INTEIRA (soma de todas as lojas
      // mais o que já é lançado a nível de rede) — não só o que é lançado a
      // nível de rede, que sozinho é uma fração pequena.
      this.prisma.ledgerEntry.findMany({ where: { period, account_id: { in: [...revenueAccountIds] } } }),
      this.prisma.storeVisitCount.findMany({ where: { period } }),
    ])
    const networkByAccount = new Map<number, number>()
    for (const entry of networkEntries) {
      networkByAccount.set(entry.account_id, (networkByAccount.get(entry.account_id) ?? 0) + entry.amount_cents)
    }

    // Driver de receita (rede inteira) — também a base do repasse Plena
    // Saúde abaixo, mas ali é 5% da PRÓPRIA loja, nunca dividido por nada.
    const storeRevenue = [...amounts.entries()]
      .filter(([accountId]) => revenueAccountIds.has(accountId))
      .reduce((sum, [, cents]) => sum + cents, 0)
    const networkRevenue = allRevenueEntries.reduce((sum, entry) => sum + entry.amount_cents, 0)
    const revenueShare = networkRevenue > 0 ? storeRevenue / networkRevenue : 0

    // Driver de visitas.
    const storeVisits = visitCounts.find(v => v.store_id === storeId)?.visit_count ?? 0
    const networkVisits = visitCounts.reduce((sum, v) => sum + v.visit_count, 0)
    const visitShare = networkVisits > 0 ? storeVisits / networkVisits : 0

    // Driver de divisão igual: quantas lojas tiveram receita real lançada
    // neste período — proxy de "loja com operação ativa no mês", sem
    // depender de uma chamada a `stores-service` (database-per-service).
    const activeStoreCount = await this.prisma.ledgerEntry
      .findMany({
        where: { period, store_id: { not: null }, account_id: { in: [...revenueAccountIds] } },
        distinct: ['store_id'],
        select: { store_id: true },
      })
      .then(rows => rows.length)
    const equalShare = activeStoreCount > 0 ? 1 / activeStoreCount : 0

    for (const [accountId, networkCents] of networkByAccount) {
      if (revenueAccountIds.has(accountId)) continue
      if (amounts.has(accountId)) continue

      const code = codeById.get(accountId)
      if (code && AccountingService.PLENA_SAUDE_FLAT_RATE_CODES.has(code)) continue // fórmula própria abaixo, não rateio de networkCents

      const share = code && AccountingService.VISIT_DRIVEN_CODES.has(code)
        ? visitShare
        : code && AccountingService.EQUAL_SPLIT_CODES.has(code)
          ? equalShare
          : code && AccountingService.REVENUE_DRIVEN_CODES.has(code)
            ? revenueShare
            : 0 // sem driver conhecido: fica só na rede, nunca estimado por padrão

      if (share === 0) continue
      const allocatedCents = Math.round(networkCents * share)
      if (allocatedCents === 0) continue
      amounts.set(accountId, allocatedCents)
      allocated.add(accountId)
    }

    // Repasse Plena Saúde: 5% da receita da PRÓPRIA loja, direto — não
    // depende de existir lançamento de rede pra essa conta no período (ao
    // contrário do loop acima, que só roda pra conta com `networkCents`).
    if (AccountingService.PLENA_SAUDE_STORE_IDS.has(storeId) && storeRevenue > 0) {
      for (const code of AccountingService.PLENA_SAUDE_FLAT_RATE_CODES) {
        const account = accounts.find(a => a.code === code)
        if (!account || amounts.has(account.id)) continue
        const allocatedCents = Math.round(storeRevenue * AccountingService.PLENA_SAUDE_REPASSE_RATE)
        if (allocatedCents === 0) continue
        amounts.set(account.id, allocatedCents)
        allocated.add(account.id)
      }
    }

    return allocated
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
