import { describe, it, expect } from "@jest/globals";
import { periodOf, addMonths, resolveAnalysisWindow } from "./temporal";
import { DEFAULT_PARAMETERS } from "./parameters";

describe("temporal", () => {
  describe("periodOf", () => {
    it("extracts YYYY-MM from ISO date", () => {
      expect(periodOf("2026-09-15")).toBe("2026-09");
      expect(periodOf("2025-01-01")).toBe("2025-01");
      expect(periodOf("2026-12-31")).toBe("2026-12");
    });
  });

  describe("addMonths", () => {
    it("adds positive months", () => {
      expect(addMonths("2026-09", 1)).toBe("2026-10");
      expect(addMonths("2026-09", 3)).toBe("2026-12");
    });

    it("subtracts negative months", () => {
      expect(addMonths("2026-09", -1)).toBe("2026-08");
      expect(addMonths("2026-09", -3)).toBe("2026-06");
    });

    it("crosses year boundary forward (December to January)", () => {
      expect(addMonths("2025-12", 1)).toBe("2026-01");
      expect(addMonths("2025-12", 3)).toBe("2026-03");
    });

    it("crosses year boundary backward (January to December)", () => {
      expect(addMonths("2026-01", -1)).toBe("2025-12");
      expect(addMonths("2026-01", -3)).toBe("2025-10");
    });

    it("pads single-digit months with zero", () => {
      expect(addMonths("2026-09", -9)).toBe("2025-12");
      expect(addMonths("2026-09", -8)).toBe("2026-01");
    });

    it("handles multiple-year boundaries", () => {
      expect(addMonths("2025-12", 13)).toBe("2027-01");
      expect(addMonths("2027-01", -13)).toBe("2025-12");
    });
  });

  describe("resolveAnalysisWindow", () => {
    const defaultParameters = DEFAULT_PARAMETERS;

    it("produces primaryClosedPeriods with 3-month window for 2026-09-15", () => {
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-06", "2026-07", "2026-08"],
        parameters: defaultParameters,
      });

      expect(result.primaryClosedPeriods).toEqual(["2026-06", "2026-07", "2026-08"]);
    });

    it("sets currentInProgressPeriod to current month", () => {
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-06", "2026-07", "2026-08"],
        parameters: defaultParameters,
      });

      expect(result.currentInProgressPeriod).toBe("2026-09");
    });

    it("excludes most recent period from qualifyingRestockPeriods by default", () => {
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-06", "2026-07", "2026-08"],
        parameters: defaultParameters,
      });

      expect(result.qualifyingRestockPeriods).toEqual(["2026-06", "2026-07"]);
    });

    it("includes all periods when most recent is the only restock ever", () => {
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-08"], // Only one restock, in August
        parameters: defaultParameters,
      });

      expect(result.qualifyingRestockPeriods).toEqual(["2026-06", "2026-07", "2026-08"]);
    });

    it("returns empty qualifyingRestockPeriods with 1-month window when only period is most recent and not an exception", () => {
      const params = {
        ...defaultParameters,
        window: { primaryWindowMonths: 1, recurrenceLookbackMonths: 6 },
      };

      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-07", "2026-08"], // Multiple restocks, so NOT the exception
        parameters: params,
      });

      expect(result.primaryClosedPeriods).toEqual(["2026-08"]);
      expect(result.qualifyingRestockPeriods).toEqual([]); // slice(0, -1) on 1-element array is []
    });

    it("includes recurrenceLookbackPeriods based on lookback months parameter", () => {
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
        parameters: defaultParameters, // recurrenceLookbackMonths: 6
      });

      expect(result.recurrenceLookbackPeriods).toEqual([
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
      ]);
    });

    it("returns correct storeId and sku in window", () => {
      const result = resolveAnalysisWindow({
        storeId: 42,
        sku: "PROD-XYZ",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-08"],
        parameters: defaultParameters,
      });

      expect(result.storeId).toBe(42);
      expect(result.sku).toBe("PROD-XYZ");
    });

    it("handles year boundary correctly for multiple lookback periods", () => {
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-01-15",
        allKnownRestockPeriods: ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"],
        parameters: defaultParameters, // recurrenceLookbackMonths: 6
      });

      expect(result.primaryClosedPeriods).toEqual(["2025-10", "2025-11", "2025-12"]);
      expect(result.currentInProgressPeriod).toBe("2026-01");
      expect(result.recurrenceLookbackPeriods).toEqual([
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
      ]);
    });

    it("correctly handles exception rule with restocks spanning multiple periods", () => {
      // Multiple restocks, but most recent is the only one in August
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: ["2026-06", "2026-07", "2026-08"],
        parameters: defaultParameters,
      });

      // Should exclude August because it's most recent and NOT the only restock ever
      expect(result.qualifyingRestockPeriods).toEqual(["2026-06", "2026-07"]);
    });

    it("excludes most recent closed period even when restock is in in-progress period", () => {
      // Only restock is in the in-progress period (2026-06), not in a closed period
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-06-30",
        allKnownRestockPeriods: ["2026-06"], // Only restock is in the in-progress period
        parameters: defaultParameters,
      });

      // primaryClosedPeriods are [2026-03, 2026-04, 2026-05]; mostRecent is 2026-05
      // isOnlyRestockEver = false (2026-06 !== 2026-05), so exclude most recent closed period
      expect(result.primaryClosedPeriods).toEqual(["2026-03", "2026-04", "2026-05"]);
      expect(result.qualifyingRestockPeriods).toEqual(["2026-03", "2026-04"]);
    });

    it("handles empty restock history by excluding most recent period", () => {
      const result = resolveAnalysisWindow({
        storeId: 1,
        sku: "SKU-123",
        today: "2026-09-15",
        allKnownRestockPeriods: [], // No restocks recorded
        parameters: defaultParameters,
      });

      // Empty restock history means isOnlyRestockEver = false, so exclude most recent period
      expect(result.primaryClosedPeriods).toEqual(["2026-06", "2026-07", "2026-08"]);
      expect(result.qualifyingRestockPeriods).toEqual(["2026-06", "2026-07"]); // Excludes most recent
      expect(result.currentInProgressPeriod).toBe("2026-09");
    });
  });
});
