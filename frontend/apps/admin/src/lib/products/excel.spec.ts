import { describe, expect, it } from "@jest/globals";
import * as XLSX from "xlsx";

import type { Product } from "@/lib/api/products";
import { PRODUCT_HEADER, buildProductsWorkbook, eanRows, productRows, type ProductSheetInput } from "./excel";

const product: Product = {
  id: 2, sku: "110024", name: "Novo sabor de marmita", category: "meal", subcategory: "Marmitas", supplier_id: 5, status: "active", units_per_package: 12, package_type: "caixa", fractionable: false, sale_unit: "un", brand: "Crystal", purchase_unit: "CX",
  ean: "7891000100103",
  eans: [
    { id: 1, ean: "7891000100103", status: "active", is_primary: true, valid_from: "2026-10-10", valid_to: null, source: "invoice_import", actor: "ana@agiliz.ai", note: null },
    { id: 2, ean: "7891000100222", status: "active", is_primary: false, valid_from: null, valid_to: null, source: "manual", actor: null, note: "embalagem nova" },
    { id: 3, ean: "7890000000001", status: "inactive", is_primary: false, valid_from: null, valid_to: "2026-09-01", source: "manual", actor: null, note: null },
  ],
  origin: { type: "invoice", invoice_number: "13021", supplier_id: 5, purchase_id: 9, on: "2026-10-10", actor: "ana@agiliz.ai" },
};
const bare: Product = { id: 3, sku: "SKU-1", name: "Sem nada", category: "snack", units_per_package: null, package_type: null, fractionable: null };

const item = (over: Partial<ProductSheetInput> = {}): ProductSheetInput => ({ product, costCents: 620, costDate: "2026-10-10", ...over });

describe("planilha do catálogo", () => {
  it("uma linha por produto, na ordem do cabeçalho, com o último custo unitário e a data, e sem preço de venda nem margem", () => {
    const [row] = productRows([item()]);

    expect(row).toHaveLength(PRODUCT_HEADER.length);
    expect(PRODUCT_HEADER.join("|")).not.toMatch(/Preço|Margem/);
    expect(row.slice(0, 7)).toEqual(["110024", "Novo sabor de marmita", "Refeição", "Marmitas", "Crystal", "Ativo", "7891000100103"]);
    expect(row[7]).toBe("7891000100222");
    expect(row[8]).toBe("7890000000001");
    expect(row.slice(9, 15)).toEqual(["un", "CX", "caixa", 12, 6.2, "2026-10-10"]);
    expect(row[15]).toBe("Cadastro originado de NF-e 13021 em 10/10/2026 por ana@agiliz.ai");
  });

  it("sem custo as células ficam vazias: nunca zero; custo zero registrado é custo", () => {
    const [noCost] = productRows([item({ costCents: null, costDate: null })]);
    const [free] = productRows([item({ costCents: 0 })]);

    expect(noCost.slice(13, 15)).toEqual([null, null]);
    expect(free[13]).toBe(0);
  });

  it("a categoria vem do nome no cadastro de categorias; sem ele, a chave (nunca em branco)", () => {
    const [named] = productRows([item({ categoryName: "Congelados" })]);
    const [fallback] = productRows([item({ product: { ...product, category: "nova-categoria" } })]);

    expect(named[2]).toBe("Congelados");
    expect(fallback[2]).toBe("nova-categoria");
  });

  it("a aba de EANs traz um por linha, inclusive os inativos, com situação e validade", () => {
    const rows = eanRows([item(), { product: bare, costCents: null, costDate: null }]);

    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual(["110024", "Novo sabor de marmita", "7890000000001", "Inativo", "Não", null, "2026-09-01", "manual", null, null]);
    expect(rows[0][4]).toBe("Sim");
  });

  it("monta o arquivo com as duas abas e formata o custo como dinheiro", () => {
    const workbook = buildProductsWorkbook([item()]);

    expect(workbook.SheetNames).toEqual(["Produtos", "EANs"]);
    const sheet = workbook.Sheets.Produtos;
    expect(sheet["N2"].v).toBe(6.2);
    expect(sheet["N2"].z).toBe('"R$" #,##0.00');
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.EANs)).toHaveLength(3);
  });
});
