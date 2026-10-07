import { describe, expect, it } from "@jest/globals";

import type { CategoryRow, ClassificationResult } from "@/lib/api/products";
import { EMPTY_CLASSIFICATION, activeCategories, applySuggestion, categoryName, chooseAlternative, chooseCategory, chooseSubcategory, subcategoriesFor, unitCostCents, type ClassificationState } from "./taxonomy";

const sub = (id: number, name: string, status: "active" | "inactive" = "active") => ({ id, category_id: 1, name, keywords: [], status, products: 0 });
const rows: CategoryRow[] = [
  { id: 1, key: "beverage", name: "Bebida", keywords: [], status: "active", products: 3, subcategories: [sub(1, "Energéticos"), sub(2, "Chás"), sub(3, "Antiga", "inactive")] },
  { id: 2, key: "snack", name: "Lanche", keywords: [], status: "active", products: 5, subcategories: [sub(4, "Chocolates")] },
  { id: 3, key: "congelados", name: "Congelados", keywords: [], status: "inactive", products: 0, subcategories: [] },
];
const clear = (categoryKey: string, subcategory: string | null): ClassificationResult => ({ confidence: "clear", best: { categoryKey, categoryName: categoryKey, subcategory, matched: ["x"], score: 2 }, alternatives: [] });

describe("categoryName", () => {
  it("usa o nome do cadastro; sem ele o nome antigo; sem esse, a própria chave — nunca esconde nem vira 'Outros'", () => {
    expect(categoryName("beverage", rows)).toBe("Bebida");
    expect(categoryName("congelados", rows)).toBe("Congelados");
    expect(categoryName("meal", undefined)).toBe("Refeição");
    expect(categoryName("nova-categoria", rows)).toBe("nova-categoria");
    expect(categoryName(null, rows)).toBe("Sem categoria");
  });
});

describe("categorias e subcategorias oferecidas", () => {
  it("só as categorias ativas são oferecidas para uma escolha nova", () => {
    expect(activeCategories(rows).map((c) => c.key)).toEqual(["beverage", "snack"]);
  });

  it("só as subcategorias da categoria escolhida, e as inativas não — a menos que seja a que o produto já tem", () => {
    expect(subcategoriesFor(rows, "beverage")).toEqual(["Energéticos", "Chás"]);
    expect(subcategoriesFor(rows, "snack")).toEqual(["Chocolates"]);
    expect(subcategoriesFor(rows, "beverage", "Antiga")).toEqual(["Energéticos", "Chás", "Antiga"]);
    expect(subcategoriesFor(rows, "beverage", "energéticos")).toEqual(["Energéticos", "Chás"]);
    expect(subcategoriesFor(rows, null)).toEqual([]);
    expect(subcategoriesFor(rows, "inexistente")).toEqual([]);
  });
});

describe("estado da classificação", () => {
  it("uma resposta clara preenche como sugerida", () => {
    expect(applySuggestion(EMPTY_CLASSIFICATION, clear("beverage", "Energéticos"))).toEqual({ category: "beverage", subcategory: "Energéticos", source: "suggested", alternatives: [] });
  });

  it("a escolha manual nunca é sobrescrita ao continuar editando o nome", () => {
    const manual = chooseCategory(EMPTY_CLASSIFICATION, "snack");

    expect(applySuggestion(manual, clear("beverage", "Energéticos"))).toBe(manual);
    expect(applySuggestion(chooseSubcategory(manual, "Chocolates"), clear("beverage", "Chás"))).toMatchObject({ category: "snack", subcategory: "Chocolates", source: "manual" });
  });

  it("a sugestão antiga é trocada quando o nome muda e a nova também é clara", () => {
    const first = applySuggestion(EMPTY_CLASSIFICATION, clear("beverage", "Energéticos"));

    expect(applySuggestion(first, clear("snack", "Chocolates"))).toMatchObject({ category: "snack", subcategory: "Chocolates", source: "suggested" });
  });

  it("sem resposta, o que uma sugestão anterior tinha posto sai (o nome mudou); nada é inventado", () => {
    const first = applySuggestion(EMPTY_CLASSIFICATION, clear("beverage", "Energéticos"));

    expect(applySuggestion(first, { confidence: "none", best: null, alternatives: [] })).toEqual(EMPTY_CLASSIFICATION);
  });

  it("ambíguo deixa pendente e oferece as alternativas; escolher uma é escolha manual", () => {
    const alternatives = [
      { categoryKey: "beverage", categoryName: "Bebida", subcategory: "Chás", matched: ["cha"], score: 1.5 },
      { categoryKey: "snack", categoryName: "Lanche", subcategory: "Chocolates", matched: ["chocolate"], score: 1.5 },
    ];
    const pending = applySuggestion(EMPTY_CLASSIFICATION, { confidence: "ambiguous", best: null, alternatives });

    expect(pending).toMatchObject({ category: "", subcategory: "", source: "none", alternatives });
    expect(chooseAlternative(pending, alternatives[1])).toEqual({ category: "snack", subcategory: "Chocolates", source: "manual", alternatives: [] });
  });

  it("trocar a categoria à mão limpa a subcategoria que não pertence à nova; manter a mesma mantém", () => {
    const state: ClassificationState = { category: "beverage", subcategory: "Chás", source: "manual", alternatives: [] };

    expect(chooseCategory(state, "snack")).toMatchObject({ category: "snack", subcategory: "", source: "manual" });
    expect(chooseCategory(state, "beverage")).toMatchObject({ category: "beverage", subcategory: "Chás" });
  });
});

describe("unitCostCents", () => {
  it("custo da caixa dividido pelo fator, ao centavo", () => {
    expect(unitCostCents(6000, 12)).toBe(500);
    expect(unitCostCents(6200, 12)).toBe(517);
    expect(unitCostCents(4349, 6)).toBe(725);
    expect(unitCostCents(500, 1)).toBe(500);
  });

  it("custo ou fator inválido não vira zero: é nulo", () => {
    expect(unitCostCents(null, 12)).toBeNull();
    expect(unitCostCents(6000, null)).toBeNull();
    expect(unitCostCents(6000, 0)).toBeNull();
    expect(unitCostCents(6000, 1.5)).toBeNull();
    expect(unitCostCents(0, 12)).toBeNull();
    expect(unitCostCents(-10, 12)).toBeNull();
    expect(unitCostCents(Number.NaN, 12)).toBeNull();
  });
});

describe("palavras-chave", () => {
  it("viram uma linha editável e voltam, sem pedaços vazios nem repetidos (caixa e acento)", async () => {
    const { keywordsToText, textToKeywords } = await import("./taxonomy");

    expect(keywordsToText(["monster", "red bull"])).toBe("monster, red bull");
    expect(textToKeywords(" monster, Energy ;; red bull\nMONSTER , energy ,  ")).toEqual(["monster", "Energy", "red bull"]);
    expect(textToKeywords("chá, CHA")).toEqual(["chá"]);
    expect(textToKeywords("   ")).toEqual([]);
  });
});
