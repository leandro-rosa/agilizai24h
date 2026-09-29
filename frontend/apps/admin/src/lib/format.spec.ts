import { describe, it, expect } from "@jest/globals";
import { monthRange } from "./format";

describe("monthRange", () => {
  it("formats a start/end period pair without shifting a day via timezone-sensitive Date parsing", () => {
    // Regression: new Date("2026-03-01").toLocaleDateString() in a UTC-3 timezone
    // renders as Feb, one month early — period() parses the string directly instead.
    expect(monthRange("2026-03", "2026-08")).toBe("mar/2026–ago/2026");
  });

  it("handles a single-month range", () => {
    expect(monthRange("2026-01", "2026-01")).toBe("jan/2026–jan/2026");
  });
});
