import { LOSS_REASONS, type LossMetrics, type LossReason, type PerReasonMetrics, type Period, type ReconciliationInput, type SalesRecordInput, type SupplyRecordInput } from "./types";

function sum<T>(rows: T[], get: (row: T) => number): number {
  return rows.reduce((total, row) => total + get(row), 0);
}

export interface ComputeLossMetricsInput {
  storeId: number;
  sku: string;
  /** TODO o histórico disponível para esta loja×SKU, não só a janela — usado para firstSeenPeriod. */
  allSalesRows: SalesRecordInput[];
  allSupplyRows: SupplyRecordInput[];
  /** Reconciliações desta loja, qualquer período — filtradas internamente por sku e pela janela. */
  allReconciliations: ReconciliationInput[];
  /** null = custo desconhecido naquele período — nunca assumir zero (spec §7). */
  costsBySkuAsOf: (sku: string, asOfPeriod: Period) => number | null;
  /** Períodos que contam para as somas da janela — já resolvidos por temporal.ts. */
  windowPeriods: Period[];
  /** Período usado para resolver o custo datado (o mais recente da janela). */
  asOfPeriod: Period;
}

export function computeLossMetrics(input: ComputeLossMetricsInput): LossMetrics {
  const inWindow = <T extends { period: Period }>(rows: T[]): T[] => rows.filter((row) => input.windowPeriods.includes(row.period));

  const salesInWindow = inWindow(input.allSalesRows);
  const supplyInWindow = inWindow(input.allSupplyRows);
  const reconciliationsInWindow = inWindow(input.allReconciliations);

  const qtyRestocked = sum(supplyInWindow, (r) => r.quantity_restocked);
  const qtySold = sum(salesInWindow, (r) => r.quantity_sold);
  const revenueCents = sum(salesInWindow, (r) => r.revenue_cents);

  const byReason = {} as Record<LossReason, PerReasonMetrics>;
  for (const reason of LOSS_REASONS) {
    const rows = reconciliationsInWindow.flatMap((r) => r.loss_by_reason_sku.filter((x) => x.reason === reason && x.sku === input.sku));
    const qtyLost = sum(rows, (r) => r.quantity);
    const valueLostCents = sum(rows, (r) => r.value_cents);
    byReason[reason] = {
      qtyLost,
      valueLostCents,
      lossToSupplyRatio: qtyRestocked > 0 ? qtyLost / qtyRestocked : null,
      lossToRevenueRatio: revenueCents > 0 ? valueLostCents / revenueCents : null,
      lossToMarginRatio: null, // preenchido abaixo, depois de resolver grossMarginCents
    };
  }

  // grossMarginCents: null assim que QUALQUER venda da janela não resolve custo — nunca assume
  // custo zero para parte das vendas e ignora o resto (spec §7, §19 "custo datado ausente").
  // Sem vendas na janela, a margem é 0 (não "desconhecida" — não há o que precificar).
  let grossMarginCents: number | null = 0;
  for (const row of salesInWindow) {
    const cost = input.costsBySkuAsOf(input.sku, input.asOfPeriod);
    if (cost === null) {
      grossMarginCents = null;
      break;
    }
    grossMarginCents = (grossMarginCents ?? 0) + row.revenue_cents - cost * row.quantity_sold;
  }

  const totalLostCents = sum(LOSS_REASONS.map((reason) => byReason[reason]), (r) => r.valueLostCents);
  for (const reason of LOSS_REASONS) {
    byReason[reason].lossToMarginRatio = grossMarginCents !== null && grossMarginCents > 0 ? byReason[reason].valueLostCents / grossMarginCents : null;
  }
  const netMarginAfterLossCents = grossMarginCents !== null ? grossMarginCents - totalLostCents : null;

  const monthsWithRestock = new Set(supplyInWindow.filter((r) => r.quantity_restocked > 0).map((r) => r.period)).size;
  const monthsWithSales = new Set(salesInWindow.filter((r) => r.quantity_sold > 0).map((r) => r.period)).size;
  const monthsAnalyzed = input.windowPeriods.length;

  const allKnownPeriods = [...new Set([...input.allSalesRows.map((r) => r.period), ...input.allSupplyRows.map((r) => r.period)])].sort();
  const firstSeenPeriod = allKnownPeriods[0] ?? null;
  const monthsSinceFirstSeen = firstSeenPeriod ? countClosedMonthsBetween(firstSeenPeriod, input.asOfPeriod) : null;

  return {
    qtyRestocked,
    qtySold,
    revenueCents,
    grossMarginCents,
    netMarginAfterLossCents,
    saleToSupplyRatio: qtyRestocked > 0 ? qtySold / qtyRestocked : null,
    monthsWithRestock,
    monthsWithSales,
    monthsAnalyzed,
    firstSeenPeriod,
    monthsSinceFirstSeen,
    byReason,
  };
}

function countClosedMonthsBetween(from: Period, to: Period): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty * 12 + tm) - (fy * 12 + fm);
}
