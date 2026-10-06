import { describe, expect, it } from "@jest/globals";

import { addDays, clampRange, dayCount, formatDay, isWholeMonths, lastDays, monthRange, monthsEndingAt, shiftRange } from "./day-range";

describe("day-range", () => {
  it("conta dias com as duas pontas e atravessa fim de mês e de ano", () => {
    expect(dayCount({ from: "2026-09-01", to: "2026-09-30" })).toBe(30);
    expect(dayCount({ from: "2026-12-25", to: "2027-01-05" })).toBe(12);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("monta mês, últimos meses e últimos dias", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthsEndingAt("2026-09-30", 3)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(monthsEndingAt("2026-02-10", 3)).toEqual({ from: "2025-12-01", to: "2026-02-28" });
    expect(lastDays("2026-09-30", 30)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("sabe se o intervalo é de meses inteiros", () => {
    expect(isWholeMonths({ from: "2026-07-01", to: "2026-09-30" })).toBe(true);
    expect(isWholeMonths({ from: "2026-07-15", to: "2026-09-30" })).toBe(false);
    expect(isWholeMonths({ from: "2026-07-01", to: "2026-09-29" })).toBe(false);
  });

  it("desloca meses inteiros por meses e dias por dias, e não passa do último dia fechado", () => {
    const latest = "2026-09-30";
    expect(shiftRange({ from: "2026-07-01", to: "2026-09-30" }, -1, latest)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(shiftRange({ from: "2026-09-01", to: "2026-09-30" }, -1, latest)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(shiftRange({ from: "2026-09-01", to: "2026-09-10" }, 1, latest)).toEqual({ from: "2026-09-11", to: "2026-09-20" });
    expect(shiftRange({ from: "2026-09-21", to: "2026-09-30" }, 1, latest)).toBeNull();
    expect(shiftRange({ from: "2026-09-01", to: "2026-09-30" }, 1, latest)).toBeNull();
  });

  it("corta o que passa de um ano mantendo o fim", () => {
    expect(clampRange({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ range: { from: "2026-09-01", to: "2026-09-30" }, clamped: false });
    const cut = clampRange({ from: "2024-01-01", to: "2026-09-30" });
    expect(cut.clamped).toBe(true);
    expect(cut.range.to).toBe("2026-09-30");
    expect(dayCount(cut.range)).toBe(366);
  });

  it("formata como o painel escreve", () => expect(formatDay("2026-09-05")).toBe("05/09/2026"));
});
