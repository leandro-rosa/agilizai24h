/**
 * The name and the definition of the margin a stored report carries. A report keeps the metric it was computed with: one written by the previous engine
 * (pricing-1 to pricing-3) is the ECONOMIC margin, with fixed costs and travel inside the price, and is never renamed to the contribution margin the
 * current engine (pricing-4 on) computes. The tag is read from the engine version stored with the report, never from today's screen.
 */
export type MarginMetricKey = "contribution" | "economic";

export interface MarginMetric {
  key: MarginMetricKey;
  name: string;
  definition: string;
}

export const CONTRIBUTION_DEFINITION =
  "Margem de contribuição: o que sobra do preço depois do custo, das perdas, dos impostos, das taxas de pagamento e das despesas que acompanham a venda. A meta vale para ela. Custos fixos e deslocamento aparecem à parte, na viabilidade da operação; o resultado após rateio é uma estimativa complementar, não o lucro líquido.";

/** The original wording, kept as it was shown with those reports. */
export const ECONOMIC_DEFINITION = "Margem econômica: o que sobra do preço depois do custo, das perdas, dos impostos, das taxas de pagamento e do rateio operacional.";

export const CONTRIBUTION_METRIC: MarginMetric = { key: "contribution", name: "Margem de contribuição", definition: CONTRIBUTION_DEFINITION };
export const ECONOMIC_METRIC: MarginMetric = { key: "economic", name: "Margem econômica", definition: ECONOMIC_DEFINITION };

/** The first engine that computes the contribution margin. */
export const FIRST_CONTRIBUTION_ENGINE = 4;

export function engineNumber(engineVersion: string | null | undefined): number | null {
  const match = /^pricing-(\d+)$/.exec(engineVersion ?? "");

  return match ? Number(match[1]) : null;
}

/** An unknown engine version is read as the current one: only a version known to predate pricing-4 is the economic margin. */
export function marginMetric(engineVersion: string | null | undefined): MarginMetric {
  const number = engineNumber(engineVersion);

  return number !== null && number < FIRST_CONTRIBUTION_ENGINE ? ECONOMIC_METRIC : CONTRIBUTION_METRIC;
}
