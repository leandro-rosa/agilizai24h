import { describe, expect, it } from "@jest/globals";

import { TEMPLATE_HEADER, buildRows, cellText, guessMapping } from "./import-mapping";

describe("guessMapping", () => {
  it("reconhece o modelo e variações comuns de cabeçalho, sem acento nem caixa", () => {
    const mapping = guessMapping(TEMPLATE_HEADER);

    expect(mapping).toMatchObject({ sku: 0, name: 1, category: 2, subcategory: 3, brand: 4, ean: 5, saleUnit: 6, purchaseUnit: 7, packageType: 8, unitsPerPackage: 9 });
    expect(guessMapping(["Código", "PRODUTO", "Código de Barras", "Fator"])).toMatchObject({ sku: 0, name: 1, ean: 2, unitsPerPackage: 3, brand: -1 });
  });

  it("uma coluna não é usada para dois campos, e o que não reconhece fica fora (-1), sem chute", () => {
    const mapping = guessMapping(["Código", "Cor"]);

    expect(mapping.sku).toBe(0);
    expect(Object.values(mapping).filter((i) => i === 0)).toHaveLength(1);
    expect(mapping.name).toBe(-1);
  });
});

describe("cellText", () => {
  it("números inteiros viram texto sem .0, vazio vira nulo, texto é aparado", () => {
    expect(cellText(7891000100103)).toBe("7891000100103");
    expect(cellText(12)).toBe("12");
    expect(cellText(1.5)).toBe("1.5");
    expect(cellText("  Água ")).toBe("Água");
    expect(cellText("   ")).toBeNull();
    expect(cellText(null)).toBeNull();
    expect(cellText(undefined)).toBeNull();
  });
});

describe("buildRows", () => {
  const table = [TEMPLATE_HEADER, ["110024", "Água", "Bebida", "", "", 7891000100103, "un", "CX", "caixa", 12], [null, null, null], ["110025", "Suco", "Bebida"]];

  it("manda só o que foi mapeado, com a linha da planilha (cabeçalho = linha 1), e pula linha totalmente vazia", () => {
    const rows = buildRows(table, guessMapping(TEMPLATE_HEADER));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ row: 2, sku: "110024", name: "Água", category: "Bebida", subcategory: null, ean: "7891000100103", purchaseUnit: "CX", unitsPerPackage: "12" });
    expect(rows[1]).toMatchObject({ row: 4, sku: "110025", name: "Suco", ean: null });
  });

  it("coluna não mapeada nunca vira valor", () => {
    const mapping = guessMapping(TEMPLATE_HEADER);
    mapping.name = -1;

    expect(buildRows(table, mapping)[0].name).toBeNull();
  });
});
