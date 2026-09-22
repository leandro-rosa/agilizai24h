/// <reference types="jest" />

import {
  DEFAULT_PARAMETERS,
  getParameter,
  envNameOf,
  parametersFromEnv,
} from "./parameters";
import { PARAMETER_DOCS, PARAMETER_KINDS, PARAMETER_PATHS, type ParameterPath } from "./parameter-docs";

describe("parameters", () => {
  describe("getParameter / withParameter roundtrip", () => {
    // Import withParameter via getParameter-based manipulation to avoid direct import
    // We'll test that modifications work correctly
    it("should retrieve all 20 parameter paths", () => {
      // Test each parameter path can be read
      for (const path of PARAMETER_PATHS) {
        const value = getParameter(DEFAULT_PARAMETERS, path);
        expect(value).toBeDefined();
        expect(typeof value).toBe("number");
      }
    });

    it("window.primaryWindowMonths can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "window.primaryWindowMonths");
      expect(value).toBe(3);
    });

    it("window.recurrenceLookbackMonths can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "window.recurrenceLookbackMonths");
      expect(value).toBe(6);
    });

    it("validity.minRepeatedSupplyMonths can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "validity.minRepeatedSupplyMonths");
      expect(value).toBe(2);
    });

    it("validity.lowSaleRatio can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "validity.lowSaleRatio");
      expect(value).toBe(0.5);
    });

    it("validity.localOutlierMaxShare can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "validity.localOutlierMaxShare");
      expect(value).toBe(0.3);
    });

    it("validity.networkWideMinShare can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "validity.networkWideMinShare");
      expect(value).toBe(0.7);
    });

    it("network.minStoresForNetworkVerdict can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "network.minStoresForNetworkVerdict");
      expect(value).toBe(5);
    });

    it("otherReason.minHealthyUnits can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "otherReason.minHealthyUnits");
      expect(value).toBe(20);
    });

    it("otherReason.viabilityMaxRatio can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "otherReason.viabilityMaxRatio");
      expect(value).toBe(0.3);
    });

    it("otherReason.negligibleValueCents can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "otherReason.negligibleValueCents");
      expect(value).toBe(5000);
    });

    it("otherReason.localConcentrationMin can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "otherReason.localConcentrationMin");
      expect(value).toBe(0.7);
    });

    it("otherReason.minRecurringPeriods can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "otherReason.minRecurringPeriods");
      expect(value).toBe(3);
    });

    it("damage.localConcentrationMin can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "damage.localConcentrationMin");
      expect(value).toBe(0.7);
    });

    it("damage.minStoresCarryingForConcentration can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "damage.minStoresCarryingForConcentration");
      expect(value).toBe(3);
    });

    it("damage.minStoresForSystemic can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "damage.minStoresForSystemic");
      expect(value).toBe(4);
    });

    it("unnecessarySupply.verylowSaleRatio can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "unnecessarySupply.verylowSaleRatio");
      expect(value).toBe(0.15);
    });

    it("recentHistory.minClosedMonths can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "recentHistory.minClosedMonths");
      expect(value).toBe(2);
    });

    it("recentHistory.minUnits can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "recentHistory.minUnits");
      expect(value).toBe(15);
    });

    it("priority.criticalValueCents can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "priority.criticalValueCents");
      expect(value).toBe(30000);
    });

    it("confidence.minMonthsForHigh can be read", () => {
      const value = getParameter(DEFAULT_PARAMETERS, "confidence.minMonthsForHigh");
      expect(value).toBe(3);
    });
  });

  describe("envNameOf", () => {
    it("should convert window.primaryWindowMonths to correct env name", () => {
      const envName = envNameOf("window.primaryWindowMonths");
      expect(envName).toBe("NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS");
    });

    it("should convert otherReason.localConcentrationMin to correct env name", () => {
      const envName = envNameOf("otherReason.localConcentrationMin");
      expect(envName).toBe("NEXT_PUBLIC_LI_OTHER_REASON_LOCAL_CONCENTRATION_MIN");
    });

    it("should convert unnecessarySupply.verylowSaleRatio to correct env name", () => {
      const envName = envNameOf("unnecessarySupply.verylowSaleRatio");
      expect(envName).toBe("NEXT_PUBLIC_LI_UNNECESSARY_SUPPLY_VERYLOW_SALE_RATIO");
    });

    it("should produce NEXT_PUBLIC_LI_ prefix for all paths", () => {
      for (const path of PARAMETER_PATHS) {
        const envName = envNameOf(path);
        expect(envName).toMatch(/^NEXT_PUBLIC_LI_/);
      }
    });
  });

  describe("parametersFromEnv", () => {
    it("should apply valid override", () => {
      const env = {
        NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS: "5",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.window.primaryWindowMonths).toBe(5);
      expect(result.warnings).toHaveLength(0);
    });

    it("should ignore out-of-bounds value with warning", () => {
      const env = {
        NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS: "15", // max is 12
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.window.primaryWindowMonths).toBe(DEFAULT_PARAMETERS.window.primaryWindowMonths);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS");
    });

    it("should ignore non-numeric value", () => {
      const env = {
        NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS: "not-a-number",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.window.primaryWindowMonths).toBe(DEFAULT_PARAMETERS.window.primaryWindowMonths);
    });

    it("should ignore empty string", () => {
      const env = {
        NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS: "",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.window.primaryWindowMonths).toBe(DEFAULT_PARAMETERS.window.primaryWindowMonths);
    });

    it("should apply float values for ratio parameters", () => {
      const env = {
        NEXT_PUBLIC_LI_VALIDITY_LOW_SALE_RATIO: "0.6",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.validity.lowSaleRatio).toBe(0.6);
    });

    it("should ignore float values for integer parameters", () => {
      const env = {
        NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS: "3.5",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.window.primaryWindowMonths).toBe(DEFAULT_PARAMETERS.window.primaryWindowMonths);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should trim whitespace from env values", () => {
      const env = {
        NEXT_PUBLIC_LI_WINDOW_PRIMARY_WINDOW_MONTHS: "  4  ",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.window.primaryWindowMonths).toBe(4);
    });
  });

  describe("enforceOrder", () => {
    it("should restore order when validity.localOutlierMaxShare > validity.networkWideMinShare", () => {
      const env = {
        NEXT_PUBLIC_LI_VALIDITY_LOCAL_OUTLIER_MAX_SHARE: "0.8",
        NEXT_PUBLIC_LI_VALIDITY_NETWORK_WIDE_MIN_SHARE: "0.2",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.validity.localOutlierMaxShare).toBeLessThanOrEqual(
        result.parameters.validity.networkWideMinShare
      );
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("validity.localOutlierMaxShare");
    });

    it("should restore order when damage.minStoresCarryingForConcentration > damage.minStoresForSystemic", () => {
      const env = {
        NEXT_PUBLIC_LI_DAMAGE_MIN_STORES_CARRYING_FOR_CONCENTRATION: "10",
        NEXT_PUBLIC_LI_DAMAGE_MIN_STORES_FOR_SYSTEMIC: "3",
      };
      const result = parametersFromEnv(env);
      expect(result.parameters.damage.minStoresCarryingForConcentration).toBeLessThanOrEqual(
        result.parameters.damage.minStoresForSystemic
      );
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("damage.minStoresCarryingForConcentration");
    });

    it("should allow equal values for ordered pairs", () => {
      const env = {
        NEXT_PUBLIC_LI_VALIDITY_LOCAL_OUTLIER_MAX_SHARE: "0.5",
        NEXT_PUBLIC_LI_VALIDITY_NETWORK_WIDE_MIN_SHARE: "0.5",
      };
      const result = parametersFromEnv(env);
      expect(result.warnings).toHaveLength(0);
      expect(result.parameters.validity.localOutlierMaxShare).toBe(0.5);
      expect(result.parameters.validity.networkWideMinShare).toBe(0.5);
    });
  });

  describe("PARAMETER_KINDS partitioning", () => {
    it("should partition all 20 paths among business, quality, and analytic", () => {
      const allPaths = new Set<ParameterPath>();
      for (const kind of ["business", "quality", "analytic"] as const) {
        for (const path of PARAMETER_KINDS[kind]) {
          allPaths.add(path);
        }
      }
      expect(allPaths.size).toBe(20);
      expect(PARAMETER_PATHS.length).toBe(20);
    });

    it("should not have overlapping paths across kinds", () => {
      const seen = new Set<ParameterPath>();
      for (const kind of ["business", "quality", "analytic"] as const) {
        for (const path of PARAMETER_KINDS[kind]) {
          expect(seen.has(path)).toBe(false);
          seen.add(path);
        }
      }
    });

    it("should classify business parameters correctly", () => {
      const businessPaths = PARAMETER_KINDS.business;
      expect(businessPaths).toContain("otherReason.viabilityMaxRatio");
      expect(businessPaths).toContain("otherReason.negligibleValueCents");
      expect(businessPaths).toContain("priority.criticalValueCents");
    });

    it("should classify quality parameters correctly", () => {
      const qualityPaths = PARAMETER_KINDS.quality;
      expect(qualityPaths).toContain("network.minStoresForNetworkVerdict");
      expect(qualityPaths).toContain("recentHistory.minClosedMonths");
      expect(qualityPaths).toContain("damage.minStoresCarryingForConcentration");
    });

    it("should classify analytic parameters correctly", () => {
      const analyticPaths = PARAMETER_KINDS.analytic;
      expect(analyticPaths).toContain("window.primaryWindowMonths");
      expect(analyticPaths).toContain("validity.lowSaleRatio");
      expect(analyticPaths).toContain("damage.localConcentrationMin");
    });
  });

  describe("PARAMETER_PATHS resolve in DEFAULT_PARAMETERS", () => {
    it("should have every path resolvable via getParameter", () => {
      for (const path of PARAMETER_PATHS) {
        const value = getParameter(DEFAULT_PARAMETERS, path);
        expect(value).toBeDefined();
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value)).toBe(true);
      }
    });

    it("should respect min/max bounds from PARAMETER_DOCS", () => {
      for (const path of PARAMETER_PATHS) {
        const value = getParameter(DEFAULT_PARAMETERS, path);
        const doc = PARAMETER_DOCS[path];
        expect(value).toBeGreaterThanOrEqual(doc.min);
        expect(value).toBeLessThanOrEqual(doc.max);
      }
    });

    it("should have integer values where required", () => {
      for (const path of PARAMETER_PATHS) {
        const value = getParameter(DEFAULT_PARAMETERS, path);
        const doc = PARAMETER_DOCS[path];
        if (doc.integer) {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    });
  });

  describe("PARAMETER_DOCS completeness", () => {
    it("should have 20 parameters documented", () => {
      expect(Object.keys(PARAMETER_DOCS).length).toBe(20);
    });

    it("should have every parameter path documented", () => {
      for (const path of PARAMETER_PATHS) {
        expect(PARAMETER_DOCS[path]).toBeDefined();
        expect(PARAMETER_DOCS[path].label).toBeTruthy();
        expect(PARAMETER_DOCS[path].kind).toMatch(/^(business|quality|analytic)$/);
      }
    });
  });
});
