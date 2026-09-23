import { describe, it, expect } from "@jest/globals";
import { DEFAULT_RESTOCK_PARAMETERS, envNameOf, formatRestockParameterValue, getRestockParameter, parametersFromEnv } from "./parameters";

describe("restock parameters", () => {
  it("reads a nested value by dotted path", () => {
    expect(getRestockParameter(DEFAULT_RESTOCK_PARAMETERS, "trend.recentMonthsCount")).toBe(3);
  });

  it("derives the env var name from the path", () => {
    expect(envNameOf("trend.recentWeightMultiplier")).toBe("NEXT_PUBLIC_RESTOCK_TREND_RECENT_WEIGHT_MULTIPLIER");
  });

  it("overrides a value from env when in bounds", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_RESTOCK_EVIDENCE_MIN_MONTHS_WITH_SALES: "3" });
    expect(getRestockParameter(parameters, "evidence.minMonthsWithSales")).toBe(3);
    expect(warnings).toEqual([]);
  });

  it("ignores and warns on an out-of-bounds env value, keeping the default", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_RESTOCK_EVIDENCE_MIN_MONTHS_WITH_SALES: "999" });
    expect(getRestockParameter(parameters, "evidence.minMonthsWithSales")).toBe(2);
    expect(warnings).toHaveLength(1);
  });

  it("resets an ordered pair to defaults when mediumMin would exceed highMin", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_RESTOCK_CONFIDENCE_MEDIUM_MIN: "90", NEXT_PUBLIC_RESTOCK_CONFIDENCE_HIGH_MIN: "70" });
    expect(getRestockParameter(parameters, "confidence.mediumMin")).toBe(40);
    expect(getRestockParameter(parameters, "confidence.highMin")).toBe(70);
    expect(warnings.some((w) => w.includes("confidence.mediumMin"))).toBe(true);
  });

  it("formats a share as a percentage", () => {
    expect(formatRestockParameterValue("trend.upThresholdPct", 0.2)).toBe("20%");
  });
});
