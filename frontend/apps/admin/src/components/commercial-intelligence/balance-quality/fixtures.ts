import type { AuditDistribution, BalanceAudit, IngestionGaps } from "@/lib/api/balance-audit";

const BINS = ["0", "≤1", "≤2", "≤5", "≤10", ">10"];

export function distribution(lines: number, over: Partial<AuditDistribution> = {}): AuditDistribution {
  const zero = Math.round(lines * 0.9);
  return {
    lines,
    share_zero: lines === 0 ? null : zero / lines,
    absolute_bins: BINS.map((label, index) => ({ label, lines: index === 0 ? zero : index === 1 ? lines - zero : 0 })),
    relative_bins: BINS.map((label, index) => ({ label, lines: index === 0 ? zero : 0 })),
    relative_undefined: 0,
    quantiles: lines === 0 ? null : { p50: 0, p90: 0, p95: 1, p99: 2, max: 4 },
    ...over,
  };
}

/** Fixture shaped like the real response — NOT real data, and never written to any database. */
export function auditFixture(over: Partial<BalanceAudit> = {}): BalanceAudit {
  return {
    range: { from: "2026-03", to: "2026-08" },
    covered: { stores: 2, visits: 40, lines: 1000, first_visit_end: "2026-03-02T08:00:00.000Z", last_visit_end: "2026-08-30T10:00:00.000Z" },
    presentation: {
      provisional: true,
      note: "Bands only slice the distributions.",
      turnover: { high_min: 20, medium_min: 5 },
      balance_bands: ["<0", "0", "1–5", "6–15", "16–40", "41+"],
      absolute_bins: BINS,
      relative_bins: BINS,
    },
    count_vs_system: {
      lines_total: 1000,
      lines_counted: 270,
      lines_uncounted: 730,
      overall: distribution(270),
      by_turnover: { high: distribution(100), medium: distribution(80), low: distribution(60), no_sales: distribution(20), unknown: distribution(10) },
      by_balance: { "<0": distribution(0), "0": distribution(50), "1–5": distribution(120), "6–15": distribution(70), "16–40": distribution(25), "41+": distribution(5) },
    },
    count_coverage: [
      {
        store_id: 1,
        month: "2026-07",
        operations: 4,
        operations_with_count: 3,
        lines: 200,
        counted_lines: 60,
        positive_balance_lines: 150,
        counted_positive_balance_lines: 50,
        share_positive_balance_counted: 50 / 150,
      },
    ],
    consumption_vs_sales: {
      compared_sku_months: 120,
      overall: distribution(120),
      by_turnover: { high: distribution(50), medium: distribution(40), low: distribution(20), no_sales: distribution(10), unknown: distribution(0) },
      store_months: [{ store_id: 1, month: "2026-07", sku_months: 60, consumption_units: 410.5, sales_units: 400, ratio: 1.02625 }],
      median_ratio: 0.99,
    },
    gaps: {
      store_months_without_sales: [{ store_id: 2, month: "2026-04", consumption_units: 130.25, sku_months: 40 }],
      balance_rises_without_event: { pairs: 12, units: 30, sku_months_excluded: 9 },
      capacity: { lines: 1000, lines_with_capacity: 0, share_with_capacity: 0, available: false },
      unavailable_stores: [],
    },
    ...over,
  };
}

export const gapsFixture: IngestionGaps = {
  from: "2026-03",
  to: "2026-08",
  periods: [{ period: "2026-06", ingestionId: "i-1", operationsWithoutClient: 33, linesWithoutClient: 7000 }],
  totals: { operationsWithoutClient: 33, linesWithoutClient: 7000 },
};
