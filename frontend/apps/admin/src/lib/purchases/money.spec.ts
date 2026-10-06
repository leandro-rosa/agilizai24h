import { describe, expect, it } from "@jest/globals";

import { formatDate, parseMoneyToCents, weekStartOf } from "./money";

describe("parseMoneyToCents", () => {
  it("lê o formato brasileiro e o decimal com ponto, sempre em centavos inteiros", () => {
    expect(parseMoneyToCents("8,50")).toBe(850);
    expect(parseMoneyToCents("8.50")).toBe(850);
    expect(parseMoneyToCents("R$ 1.234,56")).toBe(123456);
    expect(parseMoneyToCents("8")).toBe(800);
    expect(parseMoneyToCents("0")).toBe(0);
  });

  it("recusa o que não é dinheiro em vez de adivinhar", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("8,505")).toBeNull();
    expect(parseMoneyToCents("-3")).toBeNull();
  });
});

describe("datas", () => {
  it("acha a segunda-feira da semana e formata dd/mm/aaaa", () => {
    expect(weekStartOf("2026-10-07")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05");
    expect(formatDate("2026-10-05")).toBe("05/10/2026");
    expect(formatDate(null)).toBe("—");
  });
});
