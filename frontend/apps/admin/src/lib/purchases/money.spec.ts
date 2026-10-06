import { describe, expect, it } from "@jest/globals";

import { formatDate, packConversion, parseMoneyToCents, weekStartOf } from "./money";

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

describe("packConversion", () => {
  it("o fardo da nota vira unidades e o custo de uma unidade", () => {
    // 25 fardos de 6 latas a R$ 43,49 o fardo → 150 latas a R$ 7,25
    expect(packConversion(25, 4349, 6)).toEqual({ units: 150, unitCostCents: 725 });
    expect(packConversion(15, 1824, 12)).toEqual({ units: 180, unitCostCents: 152 });
  });

  it("embalagem 1 mantém o que a nota diz", () => {
    expect(packConversion(100, 800, 1)).toEqual({ units: 100, unitCostCents: 800 });
  });

  it("recusa embalagem inválida ou quantidade que não fecha em unidades inteiras, em vez de arredondar", () => {
    expect(packConversion(25, 4349, 0)).toBeNull();
    expect(packConversion(25, 4349, 2.5)).toBeNull();
    expect(packConversion(2.5, 1000, 1)).toBeNull();
    expect(packConversion(2.5, 1000, 2)).toEqual({ units: 5, unitCostCents: 500 });
  });
});
