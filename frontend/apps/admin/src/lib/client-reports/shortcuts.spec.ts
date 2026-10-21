import { describe, expect, it } from "@jest/globals";

import { shortcutRange } from "./shortcuts";

const today = new Date(2026, 4, 11); // 11/05/2026

describe("shortcutRange", () => {
  it("last 7 days = today and the 6 before", () => expect(shortcutRange("last7", today)).toEqual({ from: "2026-05-05", to: "2026-05-11" }));
  it("current month = day 1 to today", () => expect(shortcutRange("currentMonth", today)).toEqual({ from: "2026-05-01", to: "2026-05-11" }));
  it("previous month = the whole month", () => expect(shortcutRange("previousMonth", today)).toEqual({ from: "2026-04-01", to: "2026-04-30" }));
  it("previous month across a year boundary", () => expect(shortcutRange("previousMonth", new Date(2026, 0, 15))).toEqual({ from: "2025-12-01", to: "2025-12-31" }));
  it("last 7 days across a month boundary", () => expect(shortcutRange("last7", new Date(2026, 2, 3))).toEqual({ from: "2026-02-25", to: "2026-03-03" }));
});
