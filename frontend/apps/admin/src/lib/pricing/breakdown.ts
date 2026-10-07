import type { PricingProduct } from "@/lib/api/pricing";

export interface BreakdownRow {
  key: string;
  label: string;
  /** Centavos por unidade vendida ao preço atual. */
  cents: number;
  /** Fração do preço atual. */
  shareOfPrice: number;
  /** Texto curto de apoio (ex.: a taxa e a origem da perda). */
  detail?: string;
}

export interface Breakdown {
  rows: BreakdownRow[];
  economicCostCents: number;
  economicCostShare: number;
  /** "Rateio operacional utilizado exclusivamente para análise de preço…" */
  statement: string;
}

const VOUCHER_BASIS: Record<string, string> = {
  sales_weighted: "média das bandeiras ponderada pelas vendas",
  simple_average: "média simples das bandeiras",
  none: "sem taxa cadastrada",
};

const LOSS_LEVEL: Record<string, string> = { product: "do produto", category: "da categoria", store: "da loja", network: "da rede" };

/**
 * Decompõe, por unidade vendida ao preço atual, a estrutura que o motor usou — só apresenta os números dele, não decide
 * nada. `null` quando o produto não tem estrutura (dados insuficientes): a tela diz isso em vez de inventar uma linha.
 */
export function costBreakdown(product: PricingProduct): Breakdown | null {
  const structure = product.structure;
  const price = product.currentPriceCents;
  if (!structure || price === null || price <= 0) return null;

  const pct = (fraction: number) => `${(fraction * 100).toFixed(2).replace(".", ",")}%`;
  const lossCents = structure.lossAdjustedCostCents - structure.productCostCents;
  const paymentCents = price * structure.paymentRate + structure.paymentFixedCents;

  const rows: BreakdownRow[] = [
    { key: "product", label: "Custo do produto", cents: structure.productCostCents, shareOfPrice: structure.productCostCents / price },
    { key: "tax", label: "Impostos", cents: price * structure.taxRate, shareOfPrice: structure.taxRate, detail: pct(structure.taxRate) },
    { key: "loss", label: "Perdas", cents: lossCents, shareOfPrice: lossCents / price, detail: `${pct(structure.lossRate)} ${LOSS_LEVEL[structure.lossLevel] ?? ""}`.trim() },
    {
      key: "payment",
      label: "Taxas de pagamento",
      cents: paymentCents,
      shareOfPrice: paymentCents / price,
      detail: structure.paymentFixedCents > 0 ? `${pct(structure.paymentRate)} + taxa fixa por venda` : pct(structure.paymentRate),
    },
    {
      key: "voucher",
      label: "VR/VA",
      // A taxa de VR/VA já está dentro das taxas de pagamento; a linha só mostra o peso e a base, sem somar de novo.
      cents: 0,
      shareOfPrice: 0,
      detail: `${pct(structure.voucherShare)} das vendas · ${VOUCHER_BASIS[structure.voucherBasis] ?? structure.voucherBasis} (já incluso nas taxas de pagamento)`,
    },
    { key: "operating", label: "Despesas proporcionais à venda", cents: price * structure.operatingShare, shareOfPrice: structure.operatingShare, detail: `${pct(structure.operatingShare)} (repasse e similares; deslocamento e custos fixos ficam fora do preço)` },
    ...((structure.perTransactionCents ?? 0) > 0
      ? [{ key: "transaction", label: "Custo por transação", cents: structure.perTransactionCents as number, shareOfPrice: (structure.perTransactionCents as number) / price, detail: "valor por unidade vendida, distribuído pelo ticket" }]
      : []),
  ];

  const economicCostCents = rows.filter((row) => row.key !== "voucher").reduce((sum, row) => sum + row.cents, 0);

  return { rows, economicCostCents, economicCostShare: economicCostCents / price, statement: structure.statement };
}
