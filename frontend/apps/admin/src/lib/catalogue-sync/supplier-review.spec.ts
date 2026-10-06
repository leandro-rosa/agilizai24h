import { describe, expect, it } from "@jest/globals";

import type { Product } from "@/lib/api/products";
import type { Supplier } from "@/lib/api/suppliers";
import { fold, groupSheetSuppliers, planReview, suggestSuppliers, type Decision } from "./supplier-review";

const product = (sku: string, supplier_id: number | null = null): Product => ({
  id: Number(sku), sku, name: `P${sku}`, category: "snack", supplier_id, units_per_package: null, package_type: null, fractionable: null,
});
const supplier = (id: number, name: string): Supplier => ({
  id, name, legal_name: null, tax_id: null, category: "frozen", contact_name: null, phone: null, email: null, notes: null, status: "active",
});

const PRODUCTS = [product("1"), product("2"), product("3"), product("4", 9), product("5")];
const ROWS = [
  { sku: "1", supplier: "Urca" },
  { sku: "2", supplier: "urca " },
  { sku: "3", supplier: "Marsil" },
  { sku: "4", supplier: "Marsil" },
  { sku: "99", supplier: "Marsil" },
  { sku: "5", supplier: null },
];

describe("fold", () => {
  it("ignora caixa, acento e espaços repetidos", () => expect(fold("  Atacadão   LJ ")).toBe("atacadao lj"));
});

describe("groupSheetSuppliers", () => {
  const groups = groupSheetSuppliers(ROWS, PRODUCTS);

  it("junta grafias que só diferem em caixa/espaço e guarda todas", () => {
    const urca = groups.find((g) => g.key === "urca");
    expect(urca?.spellings.sort()).toEqual(["Urca", "urca"]);
    expect(urca?.toLink.map((p) => p.sku)).toEqual(["1", "2"]);
  });

  it("não sobrescreve produto que já tem fornecedor e conta SKU que não está no catálogo", () => {
    const marsil = groups.find((g) => g.key === "marsil");
    expect(marsil?.toLink.map((p) => p.sku)).toEqual(["3"]);
    expect(marsil?.alreadyLinked).toBe(1);
    expect(marsil?.missingFromCatalogue).toBe(1);
  });

  it("ignora linha sem fornecedor e ordena pelos mais produtos a vincular", () => {
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("urca");
  });
});

describe("suggestSuppliers", () => {
  const group = (name: string) => groupSheetSuppliers([{ sku: "1", supplier: name }], PRODUCTS)[0];
  const registered = [supplier(63, "Distribuidora Marsil"), supplier(83, "Urca"), supplier(75, "Quinoa Indústria de Alimentos"), supplier(1, "Marsil Norte")];

  it("é confiante quando o nome é igual ao cadastrado", () => {
    expect(suggestSuppliers(group("urca"), registered, new Map()).confident?.id).toBe(83);
  });

  it("é confiante quando o alias já foi confirmado antes", () => {
    const resolved = new Map([["mokaen", supplier(69, "Mokaen Alimentação de Verdade")]]);
    expect(suggestSuppliers(group("Mokaen"), registered, resolved).confident?.id).toBe(69);
  });

  it("oferece candidatos por inclusão sem decidir; ambíguo continua sem escolha", () => {
    const s = suggestSuppliers(group("Quinoa"), registered, new Map());
    expect(s.confident).toBeNull();
    expect(s.candidates.map((c) => c.id)).toEqual([75]);

    const ambiguous = suggestSuppliers(group("Marsil"), registered, new Map());
    expect(ambiguous.confident).toBeNull();
    expect(ambiguous.candidates.map((c) => c.id).sort()).toEqual([1, 63]);
  });

  it("não sugere nada para nome sem relação nem para grafia curta demais", () => {
    expect(suggestSuppliers(group("Juntos+"), registered, new Map()).candidates).toEqual([]);
    expect(suggestSuppliers(group("Ez"), registered, new Map()).candidates).toEqual([]);
  });
});

describe("planReview", () => {
  const groups = groupSheetSuppliers(ROWS, PRODUCTS);

  it("só grava o que foi decidido: pular e sem decisão ficam de fora", () => {
    const decisions = new Map<string, Decision>([
      ["urca", { kind: "link", supplierId: 83 }],
      ["marsil", { kind: "skip" }],
    ]);
    const plan = planReview(groups, decisions);

    expect(plan.steps.map((s) => s.group.key)).toEqual(["urca"]);
    expect(plan.products).toBe(2);
    expect(plan.suppliersToCreate).toBe(0);
  });

  it("conta fornecedores a criar e descarta criação sem nome", () => {
    const decisions = new Map<string, Decision>([
      ["urca", { kind: "create", name: "Urca Ltda", category: "frozen" }],
      ["marsil", { kind: "create", name: "  ", category: "frozen" }],
    ]);
    const plan = planReview(groups, decisions);

    expect(plan.steps).toHaveLength(1);
    expect(plan.suppliersToCreate).toBe(1);
  });
});
