/**
 * Sugestão de troca de código de barras: um SKU "sem histórico" pode ser o
 * mesmo produto de um SKU antigo do catálogo com nome parecido (caso Suflair).
 * Só SUGERE — nada é vinculado sem a confirmação do operador na tela.
 */
export const SKU_MATCH = {
  /** Similaridade mínima (Jaccard sobre palavras sem peso/unidade). PREMISSA inicial. */
  MIN_SCORE: 0.5,
  MAX_CANDIDATES: 3,
  /**
   * "Passagem de bastão": o SKU antigo só é sugerido se já vinha vendendo e, na
   * competência, caiu a no máximo esta fração do seu melhor mês anterior. Troca
   * de código = o antigo some enquanto o novo sobe; dois produtos parecidos que
   * vendem juntos (Monster 269 ml × 473 ml, sabores) não passam. PREMISSA inicial,
   * calibrada nos pares reais de set/2026 (Snickers 314→128→58; Monster estável).
   */
  HANDOVER_MAX_RATIO: 0.5,
  /** Melhor mês mínimo (un.) do SKU antigo: quem quase nunca vendeu não é "substituído" (ruído de 1 unidade). */
  HANDOVER_MIN_PEAK: 10,
} as const;

export type LinkDecision = { old_sku: string; new_sku: string; decision: "same" | "different" };

const STOP = new Set(["de", "da", "do", "com", "ao", "a", "o", "e", "em", "un", "und", "unid", "unidade", "pct", "pacote"]);

/** Minúsculas, sem acento/pontuação, sem pesos e volumes ("80g", "350ml", "2l") nem palavras vazias. */
export function nameTokens(name: string): string[] {
  const folded = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\d+([.,]\d+)?\s?(g|kg|ml|l|lt|un|und|cm)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  return folded.split(" ").filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

export function nameScore(a: string, b: string): number {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export interface Predecessor {
  oldSku: string;
  oldName: string;
  score: number;
  /** Último mês (na janela de vendas) com venda do SKU antigo; null = sem venda na janela. */
  lastSoldPeriod: string | null;
  /** Unidades do SKU antigo na competência. */
  unitsInPeriod: number;
  /** Melhor mês de vendas do SKU antigo antes da competência (na janela de vendas). */
  peakUnits: number;
}

export interface SkuSuggestion {
  newSku: string;
  newName: string;
  candidates: Predecessor[];
}

export interface CatalogueItem {
  sku: string;
  name: string;
}

export interface SalesInfo {
  lastSoldPeriod: string | null;
  unitsInPeriod: number;
  peakBefore: number;
}

export interface SuggestArgs {
  newSkus: string[];
  catalogue: CatalogueItem[];
  links: LinkDecision[];
  /** SKU → { último mês com venda, unidades na competência, melhor mês anterior }. */
  salesInfo: Map<string, SalesInfo>;
}

/** Candidatos por SKU novo, já sem pares decididos ("same" ou "different") nem SKUs já vinculados. */
export function suggestPredecessors({ newSkus, catalogue, links, salesInfo }: SuggestArgs): SkuSuggestion[] {
  const decided = new Set(links.map((l) => `${l.old_sku}>${l.new_sku}`));
  const alreadyOld = new Set(links.filter((l) => l.decision === "same").map((l) => l.old_sku));
  const byName = new Map(catalogue.map((c) => [c.sku, c.name]));
  const out: SkuSuggestion[] = [];

  for (const newSku of newSkus) {
    const newName = byName.get(newSku);
    if (!newName) continue;
    const candidates: Predecessor[] = catalogue
      .filter((c) => c.sku !== newSku && !alreadyOld.has(c.sku) && !decided.has(`${c.sku}>${newSku}`))
      .filter((c) => {
        const i = salesInfo.get(c.sku);
        // Sem venda anterior não há como provar que o código antigo "saiu de linha".
        return !!i && i.peakBefore >= SKU_MATCH.HANDOVER_MIN_PEAK && i.unitsInPeriod <= SKU_MATCH.HANDOVER_MAX_RATIO * i.peakBefore;
      })
      .map((c) => ({ c, score: nameScore(c.name, newName) }))
      .filter((x) => x.score >= SKU_MATCH.MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, SKU_MATCH.MAX_CANDIDATES)
      .map(({ c, score }) => ({
        oldSku: c.sku,
        oldName: c.name,
        score,
        lastSoldPeriod: salesInfo.get(c.sku)?.lastSoldPeriod ?? null,
        unitsInPeriod: salesInfo.get(c.sku)?.unitsInPeriod ?? 0,
        peakUnits: salesInfo.get(c.sku)?.peakBefore ?? 0,
      }));
    if (candidates.length) out.push({ newSku, newName, candidates });
  }
  return out;
}

/** old → canônico (o SKU mais novo da cadeia), seguindo só decisões "same". Ciclo impossível (o backend recusa). */
export function buildAliasMap(links: LinkDecision[]): Record<string, string> {
  const next = new Map(links.filter((l) => l.decision === "same").map((l) => [l.old_sku, l.new_sku]));
  const out: Record<string, string> = {};
  for (const old of next.keys()) {
    let cur = old;
    for (let guard = 0; guard < 20 && next.has(cur); guard += 1) cur = next.get(cur) as string;
    out[old] = cur;
  }
  return out;
}
