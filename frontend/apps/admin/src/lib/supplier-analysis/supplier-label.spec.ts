import { describe, expect, it } from "@jest/globals";

import { supplierLabel } from "./supplier-label";

describe("supplierLabel", () => {
  it("usa a grafia da planilha (alias curto contido no nome) no lugar do nome cadastrado", () => {
    expect(supplierLabel("Distribuidora Marsil", ["Marsil"])).toBe("Marsil");
    expect(supplierLabel("Assaí Atacadista", ["Assai"])).toBe("Assai");
  });

  it("mantém o nome quando não há alias contido, quando o alias é o próprio nome ou é curto demais", () => {
    expect(supplierLabel("Juntos+", [])).toBe("Juntos+");
    expect(supplierLabel("Urca", ["Urca"])).toBe("Urca");
    expect(supplierLabel("Pepsico do Brasil", ["PE"])).toBe("Pepsico do Brasil");
    expect(supplierLabel("Banco Inter", ["Mercado Livre"])).toBe("Banco Inter");
  });

  it("entre vários, escolhe o mais curto", () => {
    expect(supplierLabel("Distribuidora Marsil Norte", ["Marsil Norte", "Marsil"])).toBe("Marsil");
  });
});
