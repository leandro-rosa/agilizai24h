import type { CommercialParameters } from "./parameters";
import type { Confidence, ConfidenceCap, ConfidenceFactor, Level } from "./types";

/**
 * The graduated confidence rubric (design D9): a score out of what applies,
 * then hard caps that no score can override.
 *
 * WHAT IS A PARAMETER AND WHAT IS NOT. The thresholds that pick a tier (how
 * many joint purchases, how many days, what coverage) come from the parameters
 * and are provisional like every other. The point weights below are the
 * rubric itself: they say how much each kind of evidence is worth relative to
 * the others, and changing them changes what "High" means, so they are written
 * here, once, with the reason, and not tuned per deployment.
 */
export const RUBRIC_POINTS = {
  /** Evidence size dominates: a conclusion from few observations is weak whatever else is true. */
  evidence: { gate: 10, mid: 20, high: 30 },
  days: { full: 10, mid: 6, min: 3 },
  months: { one: 0, two: 3, three: 5 },
  stability: { consistent: 15, oneHalf: 5, contradictory: 0 },
  peers: { three: 10, some: 5, fallback: 2 },
  coupon: { full: 15, mid: 10, low: 5 },
  cost: { all: 10, high: 7, mid: 3 },
  reconciliation: { clean: 10, cleanFlaggedStore: 6, flagged: 0 },
} as const;

export type EvidenceKind = "pair" | "anchor" | "units";
export type Stability = "consistent" | "one_half" | "contradictory";

export interface ConfidenceInput {
  /** What is recommended, in the words of the message: "combos nesta loja", "o produto X". */
  target: string;
  evidence: {
    kind: EvidenceKind;
    n: number;
    /** What `n` counts, for the message: "compras conjuntas". */
    what: string;
    /** Overrides the minimum that the kind implies (a store needs fewer anchor baskets than the network). */
    gate?: number;
    /** What is missing when the gate is not met, for the message. */
    missing?: string;
  };
  daysWithSales: number;
  monthsAnalysed: number;
  stability: Stability;
  /** Comparable stores; null when the claim has none to compare against. */
  peers: { count: number; fallbackToNetwork: boolean } | null;
  /** Coupon coverage of the recommendation's scope; null when the claim does not rest on baskets. */
  couponCoverage: number | null;
  /** Share (0–1) of the involved products whose cost resolved; null when no margin is claimed. */
  costResolvedShare: number | null;
  /** Present only when loss is used. */
  reconciliation: { available: boolean; skuFlagged: boolean; storeFlaggedShare: number } | null;
  lossIsMainDriver: boolean;
  /** The main claim is a proxy (availability, potential), not an observation. */
  proxyEstimate: boolean;
  /** Baskets of the store for a store-scoped claim; null for the network. */
  storeBaskets: number | null;
}

const LEVEL_RANK: Record<Exclude<Level, "insufficient">, number> = { low: 0, medium: 1, high: 2 };
const LEVEL_BY_RANK: Exclude<Level, "insufficient">[] = ["low", "medium", "high"];

const fmt = (value: number): string => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * `Dados insuficientes para recomendar {target}: {condition} (mínimo {minimum}). {missing}`
 * — always this shape, so an empty result explains itself and says what would
 * fix it. The condition carries the observed number ("só 46 compras com
 * cupom"); `minimum` is left out for a condition that is not a count.
 */
export function insufficientData(input: { target: string; condition: string; minimum?: number; missing?: string }): string {
  const minimum = input.minimum !== undefined ? ` (mínimo ${fmt(input.minimum)})` : "";
  const missing = input.missing ? ` ${input.missing}` : "";
  return `Dados insuficientes para recomendar ${input.target}: ${input.condition}${minimum}.${missing}`;
}

function insufficient(message: string): Confidence {
  return { level: "insufficient", score: null, factors: [], caps: [], insufficient: message, withheld: [] };
}

function evidenceGate(input: ConfidenceInput, p: CommercialParameters): number {
  if (input.evidence.gate !== undefined) return input.evidence.gate;
  switch (input.evidence.kind) {
    case "pair":
      return p.association.minPairBaskets;
    case "anchor":
      return p.cartGap.minAnchorBasketsNetwork;
    default:
      return p.products.minUnits;
  }
}

function evidenceTiers(input: ConfidenceInput, p: CommercialParameters): { mid: number; high: number } {
  switch (input.evidence.kind) {
    case "pair":
      return { mid: p.confidence.evidencePairMid, high: p.confidence.evidencePairHigh };
    case "anchor":
      return { mid: p.confidence.evidenceAnchorMid, high: p.confidence.evidenceAnchorHigh };
    default:
      return { mid: p.confidence.evidenceUnitsMid, high: p.confidence.evidenceUnitsHigh };
  }
}

/** The confidence of one recommendation: factors, score, caps and, when the evidence is too thin, the sentence that says so. */
export function computeConfidence(input: ConfidenceInput, p: CommercialParameters): Confidence {
  const gate = evidenceGate(input, p);
  if (input.evidence.n < gate) {
    return insufficient(
      insufficientData({
        target: input.target,
        condition: `só ${fmt(input.evidence.n)} ${input.evidence.what}`,
        minimum: gate,
        missing: input.evidence.missing,
      }),
    );
  }

  // Loss as the main driver with no reconciliation at all is not "low confidence": there is nothing to stand on.
  if (input.reconciliation && !input.reconciliation.available && input.lossIsMainDriver) {
    return insufficient(
      insufficientData({
        target: input.target,
        condition: "a perda é o motivo principal, mas a reconciliação da loja não está disponível",
        missing: "É preciso a reconciliação do período para valorar a perda.",
      }),
    );
  }

  const factors: ConfidenceFactor[] = [];
  const caps: ConfidenceCap[] = [];
  const withheld: string[] = [];
  const add = (factor: ConfidenceFactor) => factors.push(factor);
  const cap = (ceiling: ConfidenceCap["ceiling"], reason: string) => caps.push({ ceiling, reason });

  const tiers = evidenceTiers(input, p);
  const evidencePoints = input.evidence.n >= tiers.high ? RUBRIC_POINTS.evidence.high : input.evidence.n >= tiers.mid ? RUBRIC_POINTS.evidence.mid : RUBRIC_POINTS.evidence.gate;
  add({
    key: "evidence",
    label: "Tamanho da evidência",
    earned: evidencePoints,
    max: RUBRIC_POINTS.evidence.high,
    detail: `${fmt(input.evidence.n)} ${input.evidence.what} (mínimo ${fmt(gate)}, patamares ${fmt(tiers.mid)} e ${fmt(tiers.high)})`,
  });

  const c = p.confidence;
  const daysPoints = input.daysWithSales >= c.daysFull ? RUBRIC_POINTS.days.full : input.daysWithSales >= c.daysMid ? RUBRIC_POINTS.days.mid : input.daysWithSales >= c.daysMin ? RUBRIC_POINTS.days.min : 0;
  add({ key: "days", label: "Dias com venda", earned: daysPoints, max: RUBRIC_POINTS.days.full, detail: `${input.daysWithSales} dias com venda no período` });
  if (input.daysWithSales < c.daysMin) cap("low", `menos de ${c.daysMin} dias com venda (${input.daysWithSales})`);

  const monthsPoints = input.monthsAnalysed >= 3 ? RUBRIC_POINTS.months.three : input.monthsAnalysed === 2 ? RUBRIC_POINTS.months.two : RUBRIC_POINTS.months.one;
  add({ key: "months", label: "Meses analisados", earned: monthsPoints, max: RUBRIC_POINTS.months.three, detail: `${input.monthsAnalysed} ${input.monthsAnalysed === 1 ? "mês" : "meses"} de dados` });

  const stabilityPoints =
    input.stability === "consistent" ? RUBRIC_POINTS.stability.consistent : input.stability === "one_half" ? RUBRIC_POINTS.stability.oneHalf : RUBRIC_POINTS.stability.contradictory;
  const stabilityDetail = {
    consistent: "o mesmo sinal nas duas metades do período",
    one_half: "o sinal aparece em apenas uma das metades do período",
    contradictory: "as duas metades do período se contradizem",
  }[input.stability];
  add({ key: "stability", label: "Estabilidade", earned: stabilityPoints, max: RUBRIC_POINTS.stability.consistent, detail: stabilityDetail });
  if (input.stability === "contradictory") cap("low", "a evidência se contradiz entre as metades do período");

  if (input.peers) {
    const peersPoints = input.peers.fallbackToNetwork ? RUBRIC_POINTS.peers.fallback : input.peers.count >= 3 ? RUBRIC_POINTS.peers.three : input.peers.count >= 1 ? RUBRIC_POINTS.peers.some : RUBRIC_POINTS.peers.fallback;
    add({
      key: "peers",
      label: "Lojas parecidas",
      earned: peersPoints,
      max: RUBRIC_POINTS.peers.three,
      detail: input.peers.fallbackToNetwork ? "sem lojas parecidas suficientes: comparada com a referência da rede" : `${input.peers.count} lojas parecidas`,
    });
  }

  if (input.couponCoverage !== null) {
    const coverage = input.couponCoverage;
    const couponPoints = coverage >= p.coupon.fullCoverage ? RUBRIC_POINTS.coupon.full : coverage >= c.couponCoverageMid ? RUBRIC_POINTS.coupon.mid : coverage >= p.coupon.exclusionCoverage ? RUBRIC_POINTS.coupon.low : 0;
    add({
      key: "coupon",
      label: "Cobertura de cupom",
      earned: couponPoints,
      max: RUBRIC_POINTS.coupon.full,
      detail: `${(coverage * 100).toFixed(1)}% das linhas com cupom no escopo`,
    });
    if (coverage >= p.coupon.exclusionCoverage && coverage < p.coupon.fullCoverage) {
      cap("medium", `cobertura de cupom de ${(coverage * 100).toFixed(1)}%, entre ${(p.coupon.exclusionCoverage * 100).toFixed(0)}% e ${(p.coupon.fullCoverage * 100).toFixed(0)}%`);
    }
  }

  if (input.costResolvedShare !== null) {
    const share = input.costResolvedShare;
    const costPoints = share >= 1 ? RUBRIC_POINTS.cost.all : share >= c.costHigh ? RUBRIC_POINTS.cost.high : share >= c.costMid ? RUBRIC_POINTS.cost.mid : 0;
    add({ key: "cost", label: "Custo resolvido", earned: costPoints, max: RUBRIC_POINTS.cost.all, detail: `${(share * 100).toFixed(1)}% dos produtos envolvidos com custo` });
    if (share < c.costMid) withheld.push("margem: menos de " + (c.costMid * 100).toFixed(0) + "% dos produtos envolvidos têm custo resolvido");
  }

  if (input.reconciliation) {
    const rec = input.reconciliation;
    const recPoints = !rec.available
      ? RUBRIC_POINTS.reconciliation.flagged
      : rec.skuFlagged
        ? RUBRIC_POINTS.reconciliation.flagged
        : rec.storeFlaggedShare < c.reconciliationFlaggedStoreShare
          ? RUBRIC_POINTS.reconciliation.clean
          : RUBRIC_POINTS.reconciliation.cleanFlaggedStore;
    add({
      key: "reconciliation",
      label: "Qualidade da reconciliação",
      earned: recPoints,
      max: RUBRIC_POINTS.reconciliation.clean,
      detail: !rec.available
        ? "reconciliação indisponível"
        : rec.skuFlagged
          ? "produto com estoque inconsistente"
          : `produto limpo; ${(rec.storeFlaggedShare * 100).toFixed(0)}% dos produtos da loja sinalizados`,
    });
    if (rec.available && rec.skuFlagged) {
      if (input.lossIsMainDriver) cap("low", "produto com estoque inconsistente e a perda é o motivo principal");
      else cap("medium", "produto com estoque inconsistente e a perda entra na conta");
    }
  }

  if (input.storeBaskets !== null && input.storeBaskets < c.storeMinBaskets) {
    cap("low", `a loja tem ${input.storeBaskets} compras (mínimo ${c.storeMinBaskets} para confiança maior)`);
  }
  if (input.proxyEstimate) cap("low", "a conclusão principal é uma estimativa por aproximação, não uma observação");

  const earned = factors.reduce((sum, factor) => sum + factor.earned, 0);
  const available = factors.reduce((sum, factor) => sum + factor.max, 0);
  const score = (100 * earned) / available;

  let rank = score >= c.highMin ? LEVEL_RANK.high : score >= c.mediumMin ? LEVEL_RANK.medium : LEVEL_RANK.low;
  for (const { ceiling } of caps) rank = Math.min(rank, LEVEL_RANK[ceiling]);

  return { level: LEVEL_BY_RANK[rank], score, factors, caps, insufficient: null, withheld };
}
