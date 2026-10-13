import { describe, expect, it } from "@jest/globals";

import { supplierOptions } from "./supplier-options";

const supplier = (id: number, name: string, status = "active") => ({ id, name, status });
const purchase = (supplier_id: number, supplier_name: string | null, conditions: string[]) => ({ supplier_id, supplier_name, items: conditions.map((condition) => ({ condition })) });

describe("supplierOptions — quem pode ser escolhido no acerto", () => {
  it("lista todo fornecedor ativo, mesmo sem nenhuma compra (o consignado ainda não lançado tem de poder ser escolhido)", () => {
    const options = supplierOptions([supplier(1, "Doces e congelados"), supplier(2, "Bebidas")], []);

    expect(options.map((o) => o.id)).toEqual([2, 1]);
    expect(options.every((o) => !o.consigned)).toBe(true);
  });

  it("marca e coloca primeiro quem já tem item consignado", () => {
    const options = supplierOptions([supplier(1, "Alfa"), supplier(2, "Quinoa"), supplier(3, "Beta")], [purchase(2, "Quinoa", ["paid", "on_sale"]), purchase(1, "Alfa", ["paid"])]);

    expect(options.map((o) => [o.id, o.consigned])).toEqual([[2, true], [1, false], [3, false]]);
  });

  it("não lista fornecedor inativo sem consignado, mas mantém o inativo que ainda tem item consignado", () => {
    const options = supplierOptions([supplier(1, "Antigo", "inactive"), supplier(2, "Quinoa antigo", "inactive")], [purchase(2, "Quinoa antigo", ["on_sale"])]);

    expect(options.map((o) => o.id)).toEqual([2]);
  });

  it("um fornecedor que só aparece numa compra (fora da lista carregada) ainda é escolhível, pelo nome da compra", () => {
    const options = supplierOptions([], [purchase(9, "Fornecedor da nota", ["on_sale"])]);

    expect(options).toEqual([{ id: 9, name: "Fornecedor da nota", consigned: true }]);
  });

  it("ordena por nome em português dentro de cada grupo", () => {
    const options = supplierOptions([supplier(1, "Éden"), supplier(2, "Zebra"), supplier(3, "Abc")], []);

    expect(options.map((o) => o.name)).toEqual(["Abc", "Éden", "Zebra"]);
  });
});
