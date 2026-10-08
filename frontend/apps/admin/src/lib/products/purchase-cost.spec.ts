import { purchaseCost } from "./purchase-cost";

describe("purchaseCost", () => {
  it("a box of 12 for R$ 84,00 costs R$ 7,00 per unit — the box price is never the unit cost", () => {
    const result = purchaseCost("box", "84,00", "12");

    expect(result.unitCents).toBe(700);
    expect(result.paidCents).toBe(8400);
    expect(result.explanation).toBe("Caixa com 12 unidades por R$ 84,00 → R$ 7,00 por unidade");
    expect(result.rounded).toBe(false);
  });

  it("a bundle of 6 for R$ 20,00 rounds to the centavo and says so", () => {
    const result = purchaseCost("bundle", "20,00", "6");

    expect(result.unitCents).toBe(333);
    expect(result.rounded).toBe(true);
    expect(result.explanation).toContain("arredondado");
  });

  it("by unit the paid value is the unit cost", () => {
    expect(purchaseCost("unit", "15,90", "")).toMatchObject({ unitCents: 1590, units: 1, explanation: "R$ 15,90 por unidade" });
  });

  it("in box or bundle the number of units is mandatory: without it there is no unit cost at all", () => {
    const result = purchaseCost("box", "84,00", "");

    expect(result.unitCents).toBeNull();
    expect(result.problem).toBe("Informe quantas unidades vêm na caixa.");
  });

  it("the label agrees in gender: 'na caixa', 'no fardo'", () => {
    expect(purchaseCost("box", "84,00", "").problem).toBe("Informe quantas unidades vêm na caixa.");
    expect(purchaseCost("bundle", "84,00", "").problem).toBe("Informe quantas unidades vêm no fardo.");
  });

  it.each(["1", "0", "-3", "2,5", "abc"])("units %s in a box is refused with the reason, and no unit cost", (units) => {
    const result = purchaseCost("box", "84,00", units);

    expect(result.unitCents).toBeNull();
    expect(result.problem).toMatch(/inteiro de 2 em diante/);
  });

  it("an invalid or non-positive value is refused; empty is just empty", () => {
    expect(purchaseCost("unit", "abc", "").problem).toBe("O valor informado não é válido.");
    expect(purchaseCost("unit", "0", "").problem).toBe("O valor informado não é válido.");
    expect(purchaseCost("unit", "", "")).toMatchObject({ unitCents: null, problem: null });
    expect(purchaseCost("box", "", "")).toMatchObject({ unitCents: null, problem: null });
  });
});
