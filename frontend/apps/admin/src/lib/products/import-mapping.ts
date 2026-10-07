import type { ImportRow } from "@/lib/api/products";

export type FieldKey = "sku" | "name" | "category" | "subcategory" | "brand" | "ean" | "saleUnit" | "purchaseUnit" | "packageType" | "unitsPerPackage";

export interface FieldSpec {
  key: FieldKey;
  label: string;
  required: boolean;
  /** Cabeçalhos que costumam significar este campo (dobrados: sem acento, minúsculos). */
  synonyms: string[];
}

export const IMPORT_FIELDS: FieldSpec[] = [
  { key: "sku", label: "SKU (código interno)", required: true, synonyms: ["sku", "codigo", "codigo interno", "cod", "cod interno", "codigo do produto"] },
  { key: "name", label: "Nome", required: false, synonyms: ["nome", "produto", "descricao", "nome do produto"] },
  { key: "category", label: "Categoria", required: false, synonyms: ["categoria", "grupo"] },
  { key: "subcategory", label: "Subcategoria", required: false, synonyms: ["subcategoria", "sub categoria", "subgrupo"] },
  { key: "brand", label: "Marca", required: false, synonyms: ["marca", "fabricante"] },
  { key: "ean", label: "EAN (código de barras)", required: false, synonyms: ["ean", "codigo de barras", "cod barras", "gtin", "barras"] },
  { key: "saleUnit", label: "Unidade de venda", required: false, synonyms: ["unidade de venda", "un venda", "unidade venda"] },
  { key: "purchaseUnit", label: "Unidade de compra", required: false, synonyms: ["unidade de compra", "un compra", "unidade compra", "embalagem de compra"] },
  { key: "packageType", label: "Tipo de embalagem", required: false, synonyms: ["tipo de embalagem", "embalagem", "tipo embalagem"] },
  { key: "unitsPerPackage", label: "Unidades por caixa/fardo (fator)", required: false, synonyms: ["unidades por embalagem", "un por embalagem", "fator", "unidades por caixa", "qtd por caixa", "unidades por fardo", "fator de conversao"] },
];

const fold = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Mapping column index per field (-1 = not imported). Guessed from the header names; the operator confirms or changes it. */
export type Mapping = Record<FieldKey, number>;

export function guessMapping(headers: unknown[]): Mapping {
  const folded = headers.map(fold);
  const taken = new Set<number>();
  const mapping = {} as Mapping;
  for (const field of IMPORT_FIELDS) {
    const index = folded.findIndex((header, i) => !taken.has(i) && (field.synonyms.includes(header) || header === fold(field.label)));
    mapping[field.key] = index;
    if (index >= 0) taken.add(index);
  }

  return mapping;
}

/** A spreadsheet cell as text: numbers lose the ".0", dates and blanks are empty or ISO. */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isInteger(value) ? value.toFixed(0) : String(value);
  const text = String(value).trim();

  return text === "" ? null : text;
}

/** The rows to send: header excluded, fully empty lines skipped, `row` = the line in the spreadsheet (1-based, header = line 1). */
export function buildRows(table: unknown[][], mapping: Mapping): ImportRow[] {
  const rows: ImportRow[] = [];
  table.slice(1).forEach((cells, offset) => {
    const row: ImportRow = { row: offset + 2 };
    let any = false;
    for (const field of IMPORT_FIELDS) {
      const index = mapping[field.key];
      const value = index >= 0 ? cellText(cells[index]) : null;
      if (value !== null) any = true;
      (row as unknown as Record<string, unknown>)[field.key] = value;
    }
    if (any) rows.push(row);
  });

  return rows;
}

export const TEMPLATE_HEADER = ["SKU", "Nome", "Categoria", "Subcategoria", "Marca", "EAN", "Unidade de venda", "Unidade de compra", "Tipo de embalagem", "Unidades por embalagem"];
export const TEMPLATE_EXAMPLE = ["110024", "Água com gás 500ml", "Bebida", "Águas", "Crystal", "7891000100103", "un", "CX", "caixa", 12];
export const TEMPLATE_NOTES = [
  ["Como preencher"],
  ["SKU é a chave: SKU novo cria o produto; SKU que já existe atualiza só os campos preenchidos."],
  ["Célula vazia NÃO apaga o dado que já existe (a menos que você peça isso na tela de prévia)."],
  ["Categoria: Refeição/marmita, Lanche, Bebida ou Mercearia/essenciais."],
  ["EAN: só dígitos (8 a 14). Um EAN não pode ser de dois produtos. Formate a coluna como texto para o Excel não arredondar."],
  ["Unidades por embalagem: quantas unidades vêm na caixa/fardo. O custo é sempre guardado por unidade vendida."],
  ["Custos e preços não entram aqui: o custo nasce das compras e o preço é aprovado na Precificação."],
];
