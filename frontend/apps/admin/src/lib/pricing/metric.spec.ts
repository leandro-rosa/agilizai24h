import { describe, expect, it } from "@jest/globals";

import { CONTRIBUTION_METRIC, ECONOMIC_DEFINITION, ECONOMIC_METRIC, engineNumber, marginMetric } from "./metric";

describe("marginMetric", () => {
  it("reports written by the previous engine keep their own name and definition: the economic margin", () => {
    for (const version of ["pricing-1", "pricing-2", "pricing-3"]) expect(marginMetric(version)).toBe(ECONOMIC_METRIC);
    expect(ECONOMIC_METRIC.name).toBe("Margem econômica");
    expect(ECONOMIC_DEFINITION).toBe("Margem econômica: o que sobra do preço depois do custo, das perdas, dos impostos, das taxas de pagamento e do rateio operacional.");
  });

  it("from pricing-4 on it is the contribution margin", () => {
    expect(marginMetric("pricing-4")).toBe(CONTRIBUTION_METRIC);
    expect(marginMetric("pricing-5")).toBe(CONTRIBUTION_METRIC);
  });

  it("an unknown version is read as the current engine, never as a silently renamed old one", () => {
    expect(marginMetric(undefined)).toBe(CONTRIBUTION_METRIC);
    expect(marginMetric("abc")).toBe(CONTRIBUTION_METRIC);
    expect(engineNumber("pricing-3")).toBe(3);
    expect(engineNumber("x")).toBeNull();
  });
});
