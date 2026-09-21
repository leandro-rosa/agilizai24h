import type { CouponGate } from "./quality";
import { storeCouponInsufficiency } from "./quality";
import type { MarginBreakdown } from "./kpis";
import type { LossIndex } from "./loss-index";
import type { CommercialParameters } from "./parameters";
import type { SourceStatus } from "./quality";
import type { Dataset } from "./types";

/**
 * Whether an analysis can run on today's data (design D19):
 *  - `available`: nothing weakens it;
 *  - `caveats`: it runs, with listed weaknesses and a lower confidence;
 *  - `insufficient`: the data makes it impossible or misleading;
 *  - `loading`: a source it depends on has not answered yet (not a verdict).
 * Only `insufficient` blocks. A weakness is not a block.
 */
export type AvailabilityState = "available" | "caveats" | "insufficient" | "loading";

export type AnalysisId = "combos" | "product_return" | "loss" | "behavior" | "stores" | "history";

export interface AvailabilityIndicator {
  label: string;
  value: string;
  /** The reference the value is read against, as text: never an editable setting. */
  reference?: string;
}

export interface AnalysisAvailability {
  id: AnalysisId;
  title: string;
  state: AvailabilityState;
  /** One line that says why, in the reader's words. */
  summary: string;
  /** What stops the analysis. Non-empty only when `insufficient`. */
  blockers: string[];
  /** What weakens it without stopping it. */
  caveats: string[];
  /** What would unblock it. */
  unblock: string[];
  indicators: AvailabilityIndicator[];
}

export interface AvailabilityInput {
  gate: CouponGate;
  dataset: Dataset;
  /** Margin over the network's lines: how much of the revenue has a resolved cost. */
  margin: MarginBreakdown;
  costs: SourceStatus;
  reconciliation: SourceStatus;
  lossIndex: LossIndex;
  /** Stores with transaction detail. */
  scopeStoreIds: number[];
  /** Months with per-transaction detail that are loaded (the period, plus the comparison when it has data). */
  monthsWithDetail: number;
  selectedStoreId: number | null;
}

const pct = (share: number, digits = 1): string => `${(share * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
const int = (value: number): string => value.toLocaleString("pt-BR");

const RANK: Record<Exclude<AvailabilityState, "loading">, number> = { available: 0, caveats: 1, insufficient: 2 };
const worst = (a: Exclude<AvailabilityState, "loading">, b: Exclude<AvailabilityState, "loading">) => (RANK[a] >= RANK[b] ? a : b);

function fromSource(status: SourceStatus, name: string): { state: "insufficient" | "loading" | null; blocker: string | null } {
  if (status === "loading") return { state: "loading", blocker: null };
  if (status === "no_permission") return { state: "insufficient", blocker: `${name}: sem permissão para ler.` };
  if (status === "error") return { state: "insufficient", blocker: `${name}: não foi possível carregar.` };
  return { state: null, blocker: null };
}

function combos(input: AvailabilityInput, p: CommercialParameters): AnalysisAvailability {
  const { gate } = input;
  const indicators: AvailabilityIndicator[] = [
    { label: "Cobertura de cupom da rede", value: gate.networkCoverage === null ? "—" : pct(gate.networkCoverage), reference: `libera a partir de ${pct(p.coupon.fullCoverage, 0)}` },
    { label: "Compras com cupom nas lojas elegíveis", value: int(gate.eligibleBaskets), reference: `mínimo ${int(p.coupon.eligibleBasketsMinNetwork)}` },
    { label: "Compras com 2+ produtos", value: gate.multiItemShare === null ? "—" : pct(gate.multiItemShare), reference: `mínimo ${pct(p.coupon.multiItemShareMin, 0)}` },
    { label: "Lojas fora da análise de cesta", value: int(gate.excluded.length), reference: `cobertura abaixo de ${pct(p.coupon.exclusionCoverage, 0)}` },
  ];

  let state: "available" | "caveats" | "insufficient" = gate.state === "open" ? "available" : gate.state === "partial" ? "caveats" : "insufficient";
  const blockers = gate.state === "blocked" ? [...gate.reasons] : [];
  const caveats = gate.state === "partial" ? [...gate.reasons] : [];
  const unblock = [...gate.unblock];

  // The network can be open and one store still not have enough purchases of its own.
  if (input.selectedStoreId !== null) {
    const storeMessage = storeCouponInsufficiency(gate, input.selectedStoreId, p);
    if (storeMessage) {
      state = "insufficient";
      blockers.push(storeMessage);
    }
  }

  const summary =
    state === "available"
      ? "Cobertura de cupom suficiente: os pares e o que falta no carrinho podem ser analisados."
      : state === "caveats"
        ? "Analisável só nas lojas elegíveis, com confiança limitada a Média."
        : "O cupom não cobre o suficiente para montar cestas confiáveis.";
  return { id: "combos", title: "Combos e cross-sell", state, summary, blockers, caveats, unblock, indicators };
}

function productReturn(input: AvailabilityInput, p: CommercialParameters): AnalysisAvailability {
  const base = { id: "product_return" as const, title: "Retorno dos produtos", blockers: [] as string[], caveats: [] as string[], unblock: [] as string[] };

  // Revenue by SKU across the network, and which SKUs have the minimum sample.
  const bySku = new Map<string, { units: number; revenue: number; days: Set<string> }>();
  for (const skus of input.dataset.skus.values()) {
    for (const row of skus.values()) {
      const entry = bySku.get(row.sku) ?? { units: 0, revenue: 0, days: new Set<string>() };
      entry.units += row.units;
      entry.revenue += row.revenueCents;
      for (const day of row.sellingDays) entry.days.add(day);
      bySku.set(row.sku, entry);
    }
  }
  const total = [...bySku.values()].reduce((sum, row) => sum + row.revenue, 0);
  const eligible = [...bySku.values()].filter((row) => row.units >= p.products.minUnits && row.days.size >= p.products.minSellingDays);
  const eligibleRevenue = eligible.reduce((sum, row) => sum + row.revenue, 0);
  const eligibleShare = total > 0 ? eligibleRevenue / total : 0;

  const resolvedShare = input.margin.marginCents === null ? null : 1 - (input.margin.unresolvedRevenueShare ?? 0);

  const indicators: AvailabilityIndicator[] = [
    { label: "Receita com custo resolvido", value: resolvedShare === null ? "—" : pct(resolvedShare), reference: `pleno a partir de ${pct(p.confidence.costHigh, 0)}, mínimo ${pct(p.confidence.costMid, 0)}` },
    { label: "Receita de produtos com amostra mínima", value: total > 0 ? pct(eligibleShare) : "—", reference: `pleno a partir de ${pct(p.quality.eligibleSkuRevenueFull, 0)}, mínimo ${pct(p.quality.eligibleSkuRevenueMin, 0)}` },
    { label: "Produtos com amostra mínima", value: `${int(eligible.length)} de ${int(bySku.size)}`, reference: `${int(p.products.minUnits)}+ unidades em ${int(p.products.minSellingDays)}+ dias com venda` },
  ];

  const source = fromSource(input.costs, "Custos dos produtos");
  if (source.state === "loading") return { ...base, state: "loading", summary: "Carregando os custos dos produtos.", indicators };
  if (source.state === "insufficient") {
    return { ...base, state: "insufficient", summary: "Sem custo não há margem, e sem margem não há retorno.", blockers: [source.blocker as string], unblock: ["Acesso aos custos dos produtos."], indicators };
  }

  let state: "available" | "caveats" | "insufficient" = "available";
  const blockers: string[] = [];
  const caveats: string[] = [];
  const unblock: string[] = [];

  if (resolvedShare === null) {
    state = "insufficient";
    blockers.push("Nenhum produto vendido tem custo resolvido.");
    unblock.push("Custo datado para os produtos vendidos.");
  } else if (resolvedShare < p.confidence.costMid) {
    state = "insufficient";
    blockers.push(`Só ${pct(resolvedShare)} da receita tem custo resolvido (mínimo ${pct(p.confidence.costMid, 0)}).`);
    unblock.push("Custo datado para os produtos que faltam.");
  } else if (resolvedShare < p.confidence.costHigh) {
    state = "caveats";
    caveats.push(`${pct(1 - resolvedShare)} da receita não tem custo resolvido: essa parte fica fora da margem.`);
  }

  if (total === 0 || eligibleShare < p.quality.eligibleSkuRevenueMin) {
    state = "insufficient";
    blockers.push(`Só ${pct(eligibleShare)} da receita vem de produtos com amostra mínima (mínimo ${pct(p.quality.eligibleSkuRevenueMin, 0)}).`);
    unblock.push("Mais vendas por produto, ou mais dias com venda.");
  } else if (eligibleShare < p.quality.eligibleSkuRevenueFull) {
    state = worst(state, "caveats");
    caveats.push(`${pct(1 - eligibleShare)} da receita vem de produtos sem amostra mínima: eles ficam “Em observação” ou “Dados insuficientes”.`);
  }

  const summary = state === "available" ? "Custos e amostras suficientes para classificar os produtos." : state === "caveats" ? "Classificável, com parte da receita fora da margem ou dos produtos com amostra." : "Sem custo ou sem amostra suficiente para classificar o retorno.";
  return { ...base, state, summary, blockers, caveats, unblock, indicators };
}

function loss(input: AvailabilityInput): AnalysisAvailability {
  const base = { id: "loss" as const, title: "Perdas e margem após perdas", blockers: [] as string[], caveats: [] as string[], unblock: [] as string[] };
  const total = input.scopeStoreIds.length;
  const covered = input.scopeStoreIds.filter((id) => input.lossIndex.has(id));
  const incomplete = covered.filter((id) => input.lossIndex.get(id)?.complete === false);
  const flaggedSkus = covered.reduce((sum, id) => sum + (input.lossIndex.get(id)?.inconsistentSkus.size ?? 0) + (input.lossIndex.get(id)?.unvaluedSkus.size ?? 0), 0);

  const indicators: AvailabilityIndicator[] = [
    { label: "Lojas com reconciliação do período", value: `${int(covered.length)} de ${int(total)}` },
    { label: "Lojas com reconciliação incompleta", value: int(incomplete.length), reference: "estoque inconsistente ou produto sem custo" },
    { label: "Produtos sinalizados (estoque inconsistente ou sem custo)", value: int(flaggedSkus) },
  ];

  const source = fromSource(input.reconciliation, "Reconciliação de perdas");
  if (source.state === "loading") return { ...base, state: "loading", summary: "Carregando a reconciliação.", indicators };
  if (source.state === "insufficient") {
    return { ...base, state: "insufficient", summary: "Sem reconciliação a perda é desconhecida, não zero.", blockers: [source.blocker as string], unblock: ["Acesso à reconciliação do período."], indicators };
  }
  if (covered.length === 0) {
    return { ...base, state: "insufficient", summary: "Nenhuma loja tem reconciliação do período: a perda é desconhecida.", blockers: ["Nenhuma loja tem reconciliação do período."], unblock: ["Reconciliação mensal calculada para o período."], indicators };
  }

  const caveats: string[] = [];
  if (covered.length < total) caveats.push(`${int(total - covered.length)} ${total - covered.length === 1 ? "loja sem reconciliação" : "lojas sem reconciliação"}: ficam fora da margem após perdas (perda desconhecida, não zero).`);
  if (incomplete.length > 0) caveats.push(`${int(incomplete.length)} ${incomplete.length === 1 ? "loja com reconciliação incompleta" : "lojas com reconciliação incompleta"}: as recomendações que usam perda têm confiança reduzida.`);
  const state = caveats.length > 0 ? "caveats" : "available";
  const summary = state === "available" ? "Todas as lojas reconciliadas e completas." : "Perdas disponíveis onde há reconciliação, com ressalvas.";
  return { ...base, state, summary, caveats, indicators };
}

function behavior(input: AvailabilityInput, p: CommercialParameters): AnalysisAvailability {
  const base = { id: "behavior" as const, title: "Comportamento por horário", blockers: [] as string[], caveats: [] as string[], unblock: [] as string[] };
  let lines = 0;
  let undated = 0;
  for (const store of input.dataset.stores.values()) {
    lines += store.okLines;
    undated += store.undatedLines;
  }
  const datedShare = lines > 0 ? 1 - undated / lines : null;
  const indicators: AvailabilityIndicator[] = [
    { label: "Linhas com horário legível", value: datedShare === null ? "—" : pct(datedShare), reference: `pleno a partir de ${pct(p.quality.datedLinesFull, 0)}, mínimo ${pct(p.quality.datedLinesMin, 0)}` },
    { label: "Linhas concluídas", value: int(lines), reference: `mínimo ${int(p.confidence.scopeMinOkLines)}` },
  ];

  if (datedShare === null || lines < p.confidence.scopeMinOkLines) {
    return { ...base, state: "insufficient", summary: "Poucas linhas para ler o comportamento por horário.", blockers: [`Só ${int(lines)} linhas concluídas (mínimo ${int(p.confidence.scopeMinOkLines)}).`], unblock: ["Mais vendas com detalhe por transação."], indicators };
  }
  if (datedShare < p.quality.datedLinesMin) {
    return { ...base, state: "insufficient", summary: "Horários ilegíveis demais para confiar na leitura por horário.", blockers: [`Só ${pct(datedShare)} das linhas têm horário legível (mínimo ${pct(p.quality.datedLinesMin, 0)}).`], unblock: ["Relatório de vendas com o horário de cada transação."], indicators };
  }
  if (datedShare < p.quality.datedLinesFull) {
    return { ...base, state: "caveats", summary: "Horário legível na maior parte das linhas.", caveats: [`${pct(1 - datedShare)} das linhas não têm horário legível e ficam fora da leitura por horário.`], indicators };
  }
  return { ...base, state: "available", summary: "Horários legíveis: o comportamento por horário pode ser analisado.", indicators };
}

function stores(input: AvailabilityInput, p: CommercialParameters): AnalysisAvailability {
  const base = { id: "stores" as const, title: "Lojas e lojas parecidas", blockers: [] as string[], caveats: [] as string[], unblock: [] as string[] };
  let withDetail = 0;
  let enough = 0;
  for (const store of input.dataset.stores.values()) {
    if (store.okLines === 0) continue;
    withDetail += 1;
    // A purchase is a coupon basket (kept or reused) or a coupon-less line: the same definition `/sales` uses.
    if (store.couponBaskets + store.reusedBaskets + store.orphanLines >= p.peers.minBaskets) enough += 1;
  }
  const indicators: AvailabilityIndicator[] = [
    { label: "Lojas com o mínimo de compras", value: `${int(enough)} de ${int(withDetail)}`, reference: `mínimo ${int(p.peers.minBaskets)} compras por loja` },
    { label: "Lojas necessárias para benchmark completo", value: int(p.peers.count + 1), reference: `${int(p.peers.count)} parecidas mais a própria loja` },
  ];

  if (enough === 0) {
    return { ...base, state: "insufficient", summary: "Nenhuma loja tem compras suficientes para servir de comparação.", blockers: [`Nenhuma loja chega a ${int(p.peers.minBaskets)} compras.`], unblock: ["Mais compras por loja no período."], indicators };
  }
  if (enough >= p.peers.count + 1) return { ...base, state: "available", summary: "Lojas suficientes para achar parecidas.", indicators };
  return { ...base, state: "caveats", summary: "Poucas lojas comparáveis: a rede serve de referência secundária.", caveats: [`Só ${int(enough)} ${enough === 1 ? "loja tem" : "lojas têm"} compras suficientes: onde faltarem lojas parecidas a comparação usa a rede como referência secundária, dita como tal.`], indicators };
}

function history(input: AvailabilityInput, p: CommercialParameters): AnalysisAvailability {
  const base = { id: "history" as const, title: "Comparação e histórico", blockers: [] as string[], caveats: [] as string[], unblock: [] as string[] };
  const months = input.monthsWithDetail;
  const indicators: AvailabilityIndicator[] = [{ label: "Meses com detalhe por transação", value: int(months), reference: `histórico completo a partir de ${int(p.quality.historyMonthsFull)}` }];

  if (months <= 0) return { ...base, state: "insufficient", summary: "Nenhum mês com detalhe por transação.", blockers: ["Nenhum mês com detalhe por transação."], unblock: ["Importar o relatório de vendas por rede."], indicators };
  if (months < p.quality.historyMonthsFull) {
    return { ...base, state: "caveats", summary: `${int(months)} ${months === 1 ? "mês" : "meses"} com detalhe: a estabilidade entre meses ainda não pode ser medida por inteiro.`, caveats: ["Sem histórico suficiente, a estabilidade de um padrão é lida só entre as duas metades do mês e a confiança fica mais baixa."], indicators };
  }
  return { ...base, state: "available", summary: "Histórico suficiente para medir estabilidade entre meses.", indicators };
}

/**
 * One row per analysis: its state, the indicators that decide it, what blocks it
 * and what only weakens it. Pure: it reads the same measurements as the rest of
 * the engine and applies the data-quality parameters, which are provisional.
 */
export function assessAvailability(input: AvailabilityInput, p: CommercialParameters): AnalysisAvailability[] {
  return [combos(input, p), productReturn(input, p), loss(input), behavior(input, p), stores(input, p), history(input, p)];
}
