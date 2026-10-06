/**
 * Detecta venda importada pela metade: uma loja que normalmente tem dezenas de
 * SKUs vendidos por mês e num mês tem quase nenhum. Foi o que aconteceu com
 * ago/2026 (7 lojas com 1 linha, enquanto tinham 58-87 em jul e set) e fez a
 * receita do DRE ficar abaixo do real. Só avisa — nunca corrige nem esconde.
 * Limiares são PREMISSA inicial.
 */
export const SALES_COVERAGE = {
  /** Mediana mínima de SKUs vendidos nos outros meses para a loja entrar na checagem. */
  MIN_TYPICAL_SKUS: 20,
  /** Suspeita quando o mês tem menos que esta fração da mediana dos outros meses. */
  SUSPECT_RATIO: 0.25,
} as const;

export interface SuspectStore {
  storeId: number;
  name: string;
  skus: number;
  typicalSkus: number;
}

export interface SalesCoverage {
  period: string;
  suspects: SuspectStore[];
  /** Lojas que entraram na checagem (tinham histórico para comparar). */
  checked: number;
}

interface Cell {
  storeId: number;
  period: string;
  sku: string;
  quantity: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function checkSalesCoverage(
  period: string,
  cells: Cell[],
  ingestedPeriods: string[],
  stores: { id: number; name: string }[],
): SalesCoverage | null {
  if (!ingestedPeriods.includes(period)) return null;
  const others = ingestedPeriods.filter((p) => p !== period);
  if (others.length < 2) return null; // sem histórico para comparar

  const skus = new Map<string, Set<string>>(); // `${store}|${period}` → SKUs com venda
  for (const c of cells) {
    if (c.quantity <= 0) continue;
    const k = `${c.storeId}|${c.period}`;
    (skus.get(k) ?? skus.set(k, new Set()).get(k)!).add(c.sku);
  }
  const suspects: SuspectStore[] = [];
  let checked = 0;
  for (const s of stores) {
    const typical = median(others.map((p) => skus.get(`${s.id}|${p}`)?.size ?? 0));
    if (typical < SALES_COVERAGE.MIN_TYPICAL_SKUS) continue;
    checked += 1;
    const now = skus.get(`${s.id}|${period}`)?.size ?? 0;
    if (now < SALES_COVERAGE.SUSPECT_RATIO * typical) suspects.push({ storeId: s.id, name: s.name, skus: now, typicalSkus: Math.round(typical) });
  }
  return { period, suspects: suspects.sort((a, b) => a.skus / a.typicalSkus - b.skus / b.typicalSkus), checked };
}
