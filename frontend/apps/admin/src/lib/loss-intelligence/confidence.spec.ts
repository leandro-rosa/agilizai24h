import { describe, it, expect } from "@jest/globals";
import { computeConfidence, type ConfidenceInput } from "./confidence";
import { DEFAULT_PARAMETERS } from "./parameters";

const MIN_MONTHS_FOR_HIGH = DEFAULT_PARAMETERS.confidence.minMonthsForHigh; // 3

function baseInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    qualifyingPeriodsCount: 5,
    firstSeenRecently: false,
    overwhelmingEvidence: false,
    marginUnknownButNeeded: false,
    networkComparisonMissingButNeeded: false,
    hasContradictoryData: false,
    parameters: DEFAULT_PARAMETERS,
    ...overrides,
  };
}

describe("computeConfidence", () => {
  describe("qualifyingPeriodsCount < 1 → insuficiente", () => {
    it("qualifyingPeriodsCount=0 → insuficiente", () => {
      const input = baseInput({ qualifyingPeriodsCount: 0 });
      expect(computeConfidence(input)).toBe("insuficiente");
    });
  });

  describe("firstSeenRecently — insuficiente vs baixa (the key distinction, spec §17)", () => {
    // Both cases below share the exact same qualifyingPeriodsCount (5, well above
    // minMonthsForHigh=3, which on its own would read as "alta") so the only variable
    // between them is overwhelmingEvidence. If the `!overwhelmingEvidence` in the first
    // branch's condition were ever dropped or inverted, these two tests would collapse to
    // the same tier and one of them would fail loudly.

    it("firstSeenRecently=true WITHOUT overwhelmingEvidence → insuficiente, NEVER baixa", () => {
      const input = baseInput({
        qualifyingPeriodsCount: 5,
        firstSeenRecently: true,
        overwhelmingEvidence: false,
      });
      expect(computeConfidence(input)).toBe("insuficiente");
    });

    it("firstSeenRecently=true WITH overwhelmingEvidence=true → baixa, NEVER insuficiente", () => {
      const input = baseInput({
        qualifyingPeriodsCount: 5,
        firstSeenRecently: true,
        overwhelmingEvidence: true,
      });
      expect(computeConfidence(input)).toBe("baixa");
    });
  });

  describe("marginUnknownButNeeded → insuficiente, even with a long qualifying-period history", () => {
    it("marginUnknownButNeeded=true with qualifyingPeriodsCount=12 (would otherwise be alta) → insuficiente", () => {
      // marginUnknownButNeeded must win outright regardless of how much history exists —
      // it is ORed into the same first (insuficiente) branch as the other two conditions,
      // independent of qualifyingPeriodsCount.
      const input = baseInput({
        qualifyingPeriodsCount: 12,
        firstSeenRecently: false,
        overwhelmingEvidence: false,
        marginUnknownButNeeded: true,
      });
      expect(computeConfidence(input)).toBe("insuficiente");
    });
  });

  describe("qualifyingPeriodsCount === 1 → baixa", () => {
    it("qualifyingPeriodsCount=1, no other condition firing → baixa", () => {
      const input = baseInput({ qualifyingPeriodsCount: 1 });
      expect(computeConfidence(input)).toBe("baixa");
    });
  });

  describe("networkComparisonMissingButNeeded → baixa with a long history — its own distinct condition", () => {
    it("networkComparisonMissingButNeeded=true with qualifyingPeriodsCount=10 → baixa (not insuficiente, not media/alta)", () => {
      // Long history on its own would read "alta" (10 >= minMonthsForHigh=3). This flag must
      // pull it all the way down to "baixa" specifically — not stop at "media" (it is not a
      // one-level-down adjustment like hasContradictoryData) and not fall to "insuficiente"
      // (it does not belong to the first branch).
      const input = baseInput({
        qualifyingPeriodsCount: 10,
        networkComparisonMissingButNeeded: true,
      });
      expect(computeConfidence(input)).toBe("baixa");
    });
  });

  describe("boundary: qualifyingPeriodsCount === minMonthsForHigh vs minMonthsForHigh - 1", () => {
    it(`qualifyingPeriodsCount=${MIN_MONTHS_FOR_HIGH} (== minMonthsForHigh), no other condition firing → alta`, () => {
      const input = baseInput({ qualifyingPeriodsCount: MIN_MONTHS_FOR_HIGH });
      expect(computeConfidence(input)).toBe("alta");
    });

    it(`qualifyingPeriodsCount=${MIN_MONTHS_FOR_HIGH - 1} (== minMonthsForHigh - 1), no other condition firing → media`, () => {
      const input = baseInput({ qualifyingPeriodsCount: MIN_MONTHS_FOR_HIGH - 1 });
      expect(computeConfidence(input)).toBe("media");
    });
  });

  describe("media tier: qualifyingPeriodsCount strictly between 1 and minMonthsForHigh, no other condition firing", () => {
    it("qualifyingPeriodsCount=2 → media", () => {
      const input = baseInput({ qualifyingPeriodsCount: 2 });
      expect(computeConfidence(input)).toBe("media");
    });
  });

  describe("alta tier: qualifyingPeriodsCount >= minMonthsForHigh, no other condition firing", () => {
    it("qualifyingPeriodsCount=5 (well above minMonthsForHigh) → alta", () => {
      const input = baseInput({ qualifyingPeriodsCount: 5 });
      expect(computeConfidence(input)).toBe("alta");
    });

    it("reads minMonthsForHigh from parameters, not a hardcoded 3: with minMonthsForHigh=5, qualifyingPeriodsCount=5 → alta and qualifyingPeriodsCount=4 → media", () => {
      const customParameters = { ...DEFAULT_PARAMETERS, confidence: { minMonthsForHigh: 5 } };
      expect(computeConfidence(baseInput({ qualifyingPeriodsCount: 5, parameters: customParameters }))).toBe("alta");
      expect(computeConfidence(baseInput({ qualifyingPeriodsCount: 4, parameters: customParameters }))).toBe("media");
    });
  });

  describe("hasContradictoryData — rebases one level down, never up, never below insuficiente (spec §17)", () => {
    it("a case that would be alta becomes media when hasContradictoryData=true", () => {
      // Baseline (hasContradictoryData=false) for the identical fixture is proven alta by the
      // "boundary" describe block above (qualifyingPeriodsCount === minMonthsForHigh, no other
      // condition firing). Flipping only hasContradictoryData must move it exactly one step
      // down the CONFIDENCE_ORDER array (alta → media), never two steps and never staying put.
      const input = baseInput({ qualifyingPeriodsCount: MIN_MONTHS_FOR_HIGH, hasContradictoryData: true });
      expect(computeConfidence(input)).toBe("media");
    });

    it("a case already at insuficiente stays insuficiente when hasContradictoryData=true — clamped at the last index, not undefined or out of bounds", () => {
      // Baseline (hasContradictoryData=false) for qualifyingPeriodsCount=0 is proven insuficiente
      // by the very first describe block. "insuficiente" sits at CONFIDENCE_ORDER's last index
      // (3): the production code computes Math.min(idx + 1, CONFIDENCE_ORDER.length - 1), which
      // must clamp back to index 3 instead of reading CONFIDENCE_ORDER[4] (undefined). Proving
      // the result is the literal string "insuficiente" (not undefined, not a crash) is the
      // point of this test.
      const input = baseInput({ qualifyingPeriodsCount: 0, hasContradictoryData: true });
      const result = computeConfidence(input);
      expect(result).toBe("insuficiente");
      expect(result).not.toBeUndefined();
    });

    it("full chain sanity: media → baixa and baixa → insuficiente, proving the downgrade is a uniform one-step shift across every tier, not special-cased for alta/insuficiente only", () => {
      const mediaCase = baseInput({ qualifyingPeriodsCount: MIN_MONTHS_FOR_HIGH - 1 }); // media baseline, proven above
      const baixaCase = baseInput({ qualifyingPeriodsCount: 1 }); // baixa baseline, proven above

      expect(computeConfidence({ ...mediaCase, hasContradictoryData: true })).toBe("baixa");
      expect(computeConfidence({ ...baixaCase, hasContradictoryData: true })).toBe("insuficiente");
    });
  });
});
