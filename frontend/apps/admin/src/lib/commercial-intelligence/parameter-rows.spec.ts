import { describe, it, expect } from "@jest/globals";

import { ALL_PARAMETER_PATHS, commercialBusinessRuleRows, commercialParameterCatalogSections } from "./parameter-rows";
import { DEFAULT_PARAMETERS, envNameOf, formatParameterValue, getParameter, type ParameterPath } from "./parameters";
import { PARAMETER_KINDS } from "./parameter-docs";

describe("commercialParameterCatalogSections", () => {
  const sections = commercialParameterCatalogSections(DEFAULT_PARAMETERS);

  it("places every PARAMETER_PATHS entry in exactly one section", () => {
    const occurrences = new Map<string, number>();
    for (const section of sections) {
      for (const row of section.rows) {
        occurrences.set(row.path, (occurrences.get(row.path) ?? 0) + 1);
      }
    }

    for (const path of ALL_PARAMETER_PATHS) {
      expect(occurrences.get(path)).toBe(1);
    }
    // No row outside PARAMETER_PATHS sneaks in either.
    expect(occurrences.size).toBe(ALL_PARAMETER_PATHS.length);
  });

  it("tags every row with the kind of the section that holds it", () => {
    for (const section of sections) {
      for (const row of section.rows) {
        expect(row.kind).toBe(section.kind);
      }
    }
  });

  it("matches formatParameterValue and envNameOf from parameters.ts for a known path", () => {
    const path: ParameterPath = "coupon.exclusionCoverage";
    const row = sections.flatMap((section) => section.rows).find((candidate) => candidate.path === path);
    expect(row).toBeDefined();
    expect(row?.formattedValue).toBe(formatParameterValue(path, getParameter(DEFAULT_PARAMETERS, path)));
    expect(row?.envName).toBe(envNameOf(path));
  });

  it("marks isOverridden when the value differs from the given defaults", () => {
    const overridden = { ...DEFAULT_PARAMETERS, coupon: { ...DEFAULT_PARAMETERS.coupon, exclusionCoverage: 0.5 } };
    const overriddenSections = commercialParameterCatalogSections(overridden, DEFAULT_PARAMETERS);
    const row = overriddenSections.flatMap((section) => section.rows).find((candidate) => candidate.path === "coupon.exclusionCoverage");
    expect(row?.isOverridden).toBe(true);
    expect(row?.formattedValue).toBe(formatParameterValue("coupon.exclusionCoverage", 0.5));
    expect(row?.fallbackFormattedValue).toBe(formatParameterValue("coupon.exclusionCoverage", DEFAULT_PARAMETERS.coupon.exclusionCoverage));
  });
});

describe("commercialBusinessRuleRows", () => {
  const businessRows = commercialBusinessRuleRows(DEFAULT_PARAMETERS);
  const businessPaths = new Set(businessRows.map((row) => row.path));

  it("contains exactly the paths of kind business, and only those", () => {
    expect(businessPaths.size).toBe(PARAMETER_KINDS.business.length);
    for (const path of PARAMETER_KINDS.business) {
      expect(businessPaths.has(path)).toBe(true);
    }

    const nonBusinessPaths = ALL_PARAMETER_PATHS.filter((path) => !(PARAMETER_KINDS.business as ParameterPath[]).includes(path));
    for (const path of nonBusinessPaths) {
      expect(businessPaths.has(path)).toBe(false);
    }
  });

  it("every business row also appears in its ParameterKindSection counterpart", () => {
    const sections = commercialParameterCatalogSections(DEFAULT_PARAMETERS);
    const businessSection = sections.find((section) => section.kind === "business");
    expect(businessSection).toBeDefined();
    const sectionPaths = new Set(businessSection?.rows.map((row) => row.path));
    for (const path of businessPaths) {
      expect(sectionPaths.has(path)).toBe(true);
    }
  });
});
