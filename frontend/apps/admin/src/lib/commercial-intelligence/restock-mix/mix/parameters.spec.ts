import { describe, it, expect } from "@jest/globals";
import { DEFAULT_MIX_PARAMETERS, envNameOf, formatMixParameterValue, getMixParameter, parametersFromEnv } from "./parameters";

describe("mix parameters", () => {
  it("reads a nested value by dotted path", () => {
    expect(getMixParameter(DEFAULT_MIX_PARAMETERS, "opportunity.testQuantity")).toBe(4);
  });

  it("derives the env var name from the path", () => {
    expect(envNameOf("opportunity.minNetworkStores")).toBe("NEXT_PUBLIC_MIX_OPPORTUNITY_MIN_NETWORK_STORES");
  });

  it("overrides a value from env when in bounds", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_MIX_OPPORTUNITY_TEST_QUANTITY: "6" });
    expect(getMixParameter(parameters, "opportunity.testQuantity")).toBe(6);
    expect(warnings).toEqual([]);
  });

  it("ignores and warns on an out-of-bounds env value, keeping the default", () => {
    const { parameters, warnings } = parametersFromEnv({ NEXT_PUBLIC_MIX_OPPORTUNITY_TEST_QUANTITY: "999" });
    expect(getMixParameter(parameters, "opportunity.testQuantity")).toBe(4);
    expect(warnings).toHaveLength(1);
  });

  it("formats a share as a percentage", () => {
    expect(formatMixParameterValue("classification.marginHealthyMinPct", 0.15)).toBe("15%");
  });
});
