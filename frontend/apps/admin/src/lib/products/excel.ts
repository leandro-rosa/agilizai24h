import * as XLSX from "xlsx";

import type { Product } from "@/lib/api/products";
import { CATEGORY_LABEL, STATUS_LABEL, originText } from "./labels";

export interface ProductSheetInput {
  product: Product;
  /** O nome da categoria no cadastro de categorias (a chave se não vier). */
  categoryName?: string;
  /** Último custo unitário (centavos) e o dia em que passou a valer; nulos = sem custo (célula vazia, nunca zero). */
  costCents: number | null;
  costDate: string | null;
}

type Cell = string | number | null;

const reais = (cents: number | null): number | null => (cents === null ? null : cents / 100);
const MONEY = '"R$" #,##0.00';

export const PRODUCT_HEADER = ["SKU", "Nome", "Categoria", "Subcategoria", "Marca", "Situação", "EAN principal", "Outros EANs ativos", "EANs inativos", "Unidade de venda", "Unidade de compra", "Tipo de embalagem", "Unidades por caixa/fardo", "Último custo unitário (R$)", "Data do custo", "Origem do cadastro"];

/** O catálogo, sem preço de venda nem margem: isso é análise e mora na Precificação. */
export function productRows(items: ProductSheetInput[]): Cell[][] {
  return items.map(({ product, categoryName, costCents, costDate }) => {
    const eans = product.eans ?? [];

    return [
      product.sku,
      product.name,
      categoryName ?? CATEGORY_LABEL[product.category] ?? product.category,
      product.subcategory ?? null,
      product.brand ?? null,
      STATUS_LABEL[product.status ?? "active"] ?? product.status ?? null,
      product.ean ?? null,
      eans.filter((e) => e.status === "active" && e.ean !== product.ean).map((e) => e.ean).join(", ") || null,
      eans.filter((e) => e.status === "inactive").map((e) => e.ean).join(", ") || null,
      product.sale_unit ?? null,
      product.purchase_unit ?? null,
      product.package_type,
      product.units_per_package,
      reais(costCents),
      costDate,
      originText(product.origin),
    ];
  });
}

export const EAN_HEADER = ["SKU", "Produto", "EAN", "Situação", "Principal", "Desde", "Até", "Origem", "Usuário", "Observação"];

/** Um EAN por linha, com os inativos: é o histórico que a coluna da primeira aba resume. */
export function eanRows(items: ProductSheetInput[]): Cell[][] {
  return items.flatMap(({ product }) =>
    (product.eans ?? []).map((e): Cell[] => [product.sku, product.name, e.ean, e.status === "active" ? "Ativo" : "Inativo", e.is_primary ? "Sim" : "Não", e.valid_from, e.valid_to, e.source, e.actor, e.note]),
  );
}

export function buildProductsWorkbook(items: ProductSheetInput[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const products = XLSX.utils.aoa_to_sheet([PRODUCT_HEADER, ...productRows(items)]);
  products["!cols"] = PRODUCT_HEADER.map((name, index) => ({ wch: index === 1 ? 40 : Math.max(12, name.length + 2) }));
  const range = XLSX.utils.decode_range(products["!ref"] ?? "A1");
  for (let row = 1; row <= range.e.r; row++) {
    const cost = products[XLSX.utils.encode_cell({ r: row, c: 13 })];
    if (cost && cost.t === "n") cost.z = MONEY;
  }
  XLSX.utils.book_append_sheet(workbook, products, "Produtos");

  const eans = XLSX.utils.aoa_to_sheet([EAN_HEADER, ...eanRows(items)]);
  eans["!cols"] = EAN_HEADER.map((name) => ({ wch: Math.max(14, name.length + 2) }));
  XLSX.utils.book_append_sheet(workbook, eans, "EANs");

  return workbook;
}

export function downloadProductsWorkbook(items: ProductSheetInput[], today = new Date().toISOString().slice(0, 10)): void {
  XLSX.writeFile(buildProductsWorkbook(items), `Catalogo-Produtos-Agiliz-${today}.xlsx`);
}
