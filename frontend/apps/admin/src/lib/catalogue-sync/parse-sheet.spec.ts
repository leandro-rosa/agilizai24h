import * as XLSX from "xlsx";

import { parseSheet, toCents } from "./parse-sheet";

// Planilha sintética montada em memória, só neste spec.
function book(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}
const HEAD = ["SKU", "Categoria", "Subcategoria", "EAN", "Produto", "Fornecedor", "Custo Unitário", "Preço Simulado", "qtd itens por loja", "Medida"];

describe("toCents", () => {
  it.each([
    [7.19, 719], ["R$ 7.19", 719], ["R$ 7,19", 719], ["R$ 1.234,56", 123456], ["R$ 0.00", 0], [0, 0], [12.5, 1250],
  ])("%p -> %p", (input, expected) => expect(toCents(input)).toBe(expected));
  it("empty and unreadable are null, never zero", () => {
    expect(toCents(null)).toBeNull();
    expect(toCents("")).toBeNull();
    expect(toCents("abc")).toBeNull();
  });
});

describe("parseSheet", () => {
  it("reads the real columns, with EAN as a 13-digit string and cost in cents", () => {
    const { rows, missingColumns } = parseSheet(book([HEAD, [100115, "Lanches e Snacks", "Salgadinhos", 7898977911046, "Irreal Snacks Tomate Seco 40G", "Irreal", "R$ 9.50", "R$ 16.90", 5, "unidade"]]));
    expect(missingColumns).toEqual([]);
    expect(rows[0]).toMatchObject({ row: 2, sku: "100115", ean: "7898977911046", name: "Irreal Snacks Tomate Seco 40G", supplier: "Irreal", cost_cents: 950, price_cents: 1690, package_type: "unidade", cost_error: false });
  });

  it("a formula error in the cost cell is flagged, not read as zero", () => {
    const ws = XLSX.utils.aoa_to_sheet([HEAD, [100125, "Bebidas", "Chás", 7891098041630, "Chá Matte", "Juntos+", 0, "R$ 7.90", 6, "fardo"]]);
    ws[XLSX.utils.encode_cell({ r: 1, c: 6 })] = { t: "e", v: 0x2a } as XLSX.CellObject; // #N/A
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const { rows } = parseSheet(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    expect(rows[0]).toMatchObject({ sku: "100125", cost_error: true, cost_cents: null, price_cents: 790 });
  });

  it("a real R$ 0.00 cost (Sprite zero, a gift) stays zero and is not an error", () => {
    const { rows } = parseSheet(book([HEAD, [100114, "Bebidas", "refrigerantes", 7894900000000, "Sprite zero", "Marsil", "R$ 0.00", "R$ 7.90", 12, "fardo"]]));
    expect(rows[0]).toMatchObject({ cost_cents: 0, cost_error: false });
  });

  it("an empty trailing row comes back with no sku and no name so the planner can ignore it", () => {
    const { rows } = parseSheet(book([HEAD, [100001, "Bebidas", "x", 7894900000001, "A", "F", 1, 2, 5, "fardo"], [null, null, null, null, null, null, null, null, null, null]]));
    const empty = rows.find((r) => r.row === 3);
    if (empty) expect(empty).toMatchObject({ sku: "", name: "" });
  });

  it("reports missing mandatory columns instead of guessing", () => {
    expect(parseSheet(book([["SKU", "Produto"], [1, "x"]])).missingColumns).toEqual(["cost", "price"]);
  });
});
