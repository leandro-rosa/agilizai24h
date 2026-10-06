/**
 * Lê a planilha de precificação (xlsx) no navegador e devolve as linhas no
 * formato do `catalogue-sync` do products-service. Não grava nada.
 *
 * Armadilhas reais desta planilha, tratadas aqui:
 *  - custo como número (7.19), texto "R$ 7.19"/"R$ 7,19" ou erro de fórmula (#ERROR!);
 *  - centenas de linhas no fim só com fórmula de custo (sem SKU nem nome);
 *  - EAN gravado como número de 13 dígitos (ok) ou já arredondado pelo Excel (7.89856E+12);
 *  - colunas de categoria/subcategoria deslocadas em parte das linhas.
 */
import * as XLSX from "xlsx";

export interface SheetRow {
  row: number;
  sku: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  ean: string | null;
  supplier: string | null;
  cost_cents: number | null;
  cost_error: boolean;
  price_cents: number | null;
  package_type: string | null;
}

const HEADERS = {
  sku: ["sku"],
  category: ["categoria"],
  subcategory: ["subcategoria"],
  ean: ["ean"],
  name: ["produto"],
  supplier: ["fornecedor"],
  cost: ["custo unitário", "custo unitario", "custo"],
  price: ["preço simulado", "preco simulado", "preço", "preco"],
  package: ["medida"],
} as const;

const fold = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** "R$ 1.234,56" / "R$ 7.19" / 7.19 → centavos. `null` quando vazio ou ilegível. */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  let s = String(value).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return null;
  // Com vírgula decimal ("1.234,56") os pontos são milhar; sem vírgula o ponto é decimal ("7.19").
  s = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function cellText(cell: XLSX.CellObject | undefined): string | null {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (cell.t === "e") return null;
  if (cell.t === "n") return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v);
  const s = String(cell.v).trim();
  return s === "" ? null : s;
}

export function parseSheet(buffer: ArrayBuffer): { rows: SheetRow[]; missingColumns: string[] } {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) return { rows: [], missingColumns: Object.keys(HEADERS) };
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const h = fold(cellText(ws[XLSX.utils.encode_cell({ r: range.s.r, c })]));
    for (const [key, names] of Object.entries(HEADERS) as [keyof typeof HEADERS, readonly string[]][]) {
      if (col[key] === undefined && (names as readonly string[]).includes(h)) col[key] = c;
    }
  }
  const missingColumns = (["sku", "name", "cost", "price"] as const).filter((k) => col[k] === undefined);
  if (missingColumns.length) return { rows: [], missingColumns };

  const at = (r: number, key: keyof typeof HEADERS) => (col[key] === undefined ? undefined : ws[XLSX.utils.encode_cell({ r, c: col[key] as number })]);
  const rows: SheetRow[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const costCell = at(r, "cost");
    const costError = costCell?.t === "e";
    const priceCell = at(r, "price");
    rows.push({
      row: r + 1,
      sku: cellText(at(r, "sku")) ?? "",
      name: cellText(at(r, "name")) ?? "",
      category: cellText(at(r, "category")),
      subcategory: cellText(at(r, "subcategory")),
      ean: cellText(at(r, "ean")),
      supplier: cellText(at(r, "supplier")),
      cost_cents: costError ? null : toCents(costCell?.v),
      cost_error: costError,
      price_cents: priceCell?.t === "e" ? null : toCents(priceCell?.v),
      package_type: cellText(at(r, "package")),
    });
  }
  return { rows, missingColumns: [] };
}
