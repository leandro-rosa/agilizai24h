import { describe, expect, it } from "@jest/globals";

import { CONFIDENCE_LABEL, parsePriceToCents, percent, points, signedMoney, signedPercent, STATUS_LABEL, STATUS_TONE } from "./labels";

describe("vocabulário", () => {
  it("usa as cinco situações e as quatro confianças combinadas", () => {
    expect(STATUS_LABEL).toEqual({ healthy: "Saudável", adjust: "Ajustar", opportunity: "Oportunidade", review: "Revisar", insufficient_data: "Dados insuficientes" });
    expect(CONFIDENCE_LABEL).toEqual({ high: "Alta", medium: "Média", low: "Baixa", insufficient_data: "Dados insuficientes" });
  });

  it("só saudável é verde e só ajustar/revisar são amarelos; nada é vermelho por ser 'dado insuficiente'", () => {
    expect(STATUS_TONE.healthy).toBe("positive");
    expect(STATUS_TONE.adjust).toBe("attention");
    expect(STATUS_TONE.review).toBe("attention");
    expect(STATUS_TONE.insufficient_data).toBe("neutral");
  });
});

describe("formatação que nunca transforma ausência em zero", () => {
  it("percent", () => {
    expect(percent(0.368)).toBe("36,8%");
    expect(percent(0)).toBe("0,0%");
    expect(percent(null)).toBe("—");
    expect(percent(undefined)).toBe("—");
  });

  it("points tem sinal e usa p.p.", () => {
    expect(points(0.018)).toBe("+1,8 p.p.");
    expect(points(-0.02)).toBe("−2,0 p.p.");
    expect(points(0)).toBe("0,0 p.p.");
    expect(points(null)).toBe("—");
  });

  it("signedPercent e signedMoney", () => {
    expect(signedPercent(0.104)).toBe("+10,4%");
    expect(signedPercent(-0.03)).toBe("−3,0%");
    expect(signedPercent(null)).toBe("—");
    expect(signedMoney(42000).replace(/\s/g, " ")).toBe("+ R$ 420,00");
    expect(signedMoney(-1500).replace(/\s/g, " ")).toBe("− R$ 15,00");
    expect(signedMoney(null)).toBe("—");
  });
});

describe("parsePriceToCents", () => {
  it.each([
    ["6,50", 650],
    ["R$ 6,50", 650],
    ["6.50", 650],
    ["1.234,56", 123456],
    ["7", 700],
    ["0,89", 89],
  ])("%s → %d", (input, cents) => expect(parsePriceToCents(input)).toBe(cents));

  it.each([[""], ["abc"], ["0"], ["-3"], ["0,00"]])("recusa %p", (input) => expect(parsePriceToCents(input)).toBeNull());
});
