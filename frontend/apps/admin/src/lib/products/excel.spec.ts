import { describe, expect, it } from "@jest/globals";
import * as XLSX from "xlsx";

import type { Product } from "@/lib/api/products";
import { PRODUCT_HEADER, buildProductsWorkbook, eanRows, productRows, type ProductSheetInput } from "./excel";

const product: Product = {
  id: 2, sku: "110024", name: "Novo sabor de marmita", category: "meal", subcategory: "Marmitas", supplier_id: 5, status: "active", units_per_package: 12, package_type: "caixa", fractionable: false, sale_unit: "un",
  ean: "7891000100103",
  eans: [
    { id: 1, ean: "7891000100103", status: "active", is_primary: true, valid_from: "2026-10-10", valid_to: null, source: "invoice_import", actor: "ana@agiliz.ai", note: null },
    { id: 2, ean: "7891000100222", status: "active", is_primary: false, valid_from: null, valid_to: null, source: "manual", actor: null, note: "embalagem nova" },
    { id: 3, ean: "7890000000001", status: "inactive", is_primary: false, valid_from: null, valid_to: "2026-09-01", source: "manual", actor: null, note: null },
  ],
  origin: { type: "invoice", invoice_number: "13021", supplier_id: 5, purchase_id: 9, on: "2026-10-10", actor: "ana@agiliz.ai" },
};
const bare: Product = { id: 3, sku: "SKU-1", name: "Sem nada", category: "snack", units_per_package: null, package_type: null, fractionable: null };

const item = (over: Partial<ProductSheetInput> = {}): ProductSheetInput => ({ product, supplierName: "Juntos+", costCents: 620, priceCents: 1290, ...over });

describe("planilha de produtos", () => {
  it("uma linha por produto, com as colunas na ordem do cabeçalho, valores em reais e margem como fração", () => {
    const [row] = productRows([item()]);

    expect(row).toHaveLength(PRODUCT_HEADER.length);
    expect(row.slice(0, 7)).toEqual(["110024", "Novo sabor de marmita", "Refeição", "Marmitas", "Ativo", "Juntos+", "7891000100103"]);
    expect(row[7]).toBe("7891000100222");
    expect(row[8]).toBe("7890000000001");
    expect(row.slice(12, 15)).toEqual([6.2, 12.9, (1290 - 620) / 1290]);
    expect(row[15]).toBe("Cadastro originado de NF-e 13021 em 10/10/2026 por ana@agiliz.ai");
  });

  it("sem custo ou sem preço as células ficam vazias: nunca zero, e a margem some", () => {
    const [noCost] = productRows([item({ costCents: null })]);
    const [noPrice] = productRows([item({ priceCents: null })]);
    const [bareRow] = productRows([{ product: bare, supplierName: null, costCents: null, priceCents: null }]);

    expect(noCost.slice(12, 15)).toEqual([null, 12.9, null]);
    expect(noPrice.slice(12, 15)).toEqual([6.2, null, null]);
    expect(bareRow.slice(3, 15)).toEqual([null, "Ativo", null, null, null, null, null, null, null, null, null, null]);
  });

  it("custo zero é custo (grátis), não ausência; preço zero não gera margem", () => {
    const [free] = productRows([item({ costCents: 0 })]);
    const [zeroPrice] = productRows([item({ priceCents: 0 })]);

    expect(free[12]).toBe(0);
    expect(free[14]).toBe(1);
    expect(zeroPrice[14]).toBeNull();
  });

  it("a aba de EANs traz um por linha, inclusive os inativos, com situação e validade", () => {
    const rows = eanRows([item(), { product: bare, supplierName: null, costCents: null, priceCents: null }]);

    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual(["110024", "Novo sabor de marmita", "7890000000001", "Inativo", "Não", null, "2026-09-01", "manual", null, null]);
    expect(rows[0][4]).toBe("Sim");
  });

  it("monta o arquivo com as duas abas e formata dinheiro e margem", () => {
    const workbook = buildProductsWorkbook([item()]);

    expect(workbook.SheetNames).toEqual(["Produtos", "EANs"]);
    const sheet = workbook.Sheets.Produtos;
    expect(sheet["M2"].v).toBe(6.2);
    expect(sheet["M2"].z).toBe('"R$" #,##0.00');
    expect(sheet["O2"].z).toBe("0.0%");
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.EANs)).toHaveLength(3);
  });
});
