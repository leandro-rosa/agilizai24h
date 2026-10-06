import type { Product } from "@/lib/api/products";
import type { Supplier, SupplierCategory } from "@/lib/api/suppliers";

/** Caixa, acento e espaço dobrados: "Atacadão " e "atacadao" são a mesma grafia. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Um nome de fornecedor da planilha e os produtos do catálogo que a planilha atribui a ele. */
export interface SheetSupplierGroup {
  key: string;
  /** Grafia mais frequente, para exibir. */
  label: string;
  /** Todas as grafias que caem neste grupo ("Urca", "urca"): cada uma vira alias ao confirmar. */
  spellings: string[];
  /** Produtos do catálogo sem fornecedor — os únicos que seriam vinculados. */
  toLink: Product[];
  /** Produtos que a planilha atribui a este nome mas já têm fornecedor cadastrado: nunca são sobrescritos. */
  alreadyLinked: number;
  /** SKUs da planilha que não existem no catálogo (produto novo ainda não cadastrado). */
  missingFromCatalogue: number;
}

export function groupSheetSuppliers(rows: { sku: string; supplier: string | null }[], products: Product[]): SheetSupplierGroup[] {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const groups = new Map<string, { spellings: Map<string, number>; toLink: Map<string, Product>; linked: Set<string>; missing: Set<string> }>();

  for (const row of rows) {
    const name = row.supplier?.trim();
    if (!name) continue;
    const key = fold(name);
    const group = groups.get(key) ?? { spellings: new Map(), toLink: new Map(), linked: new Set(), missing: new Set() };
    group.spellings.set(name, (group.spellings.get(name) ?? 0) + 1);
    const product = bySku.get(row.sku);
    if (!product) group.missing.add(row.sku);
    else if (product.supplier_id != null) group.linked.add(row.sku);
    else group.toLink.set(row.sku, product);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      const ranked = [...g.spellings.entries()].sort((a, b) => b[1] - a[1]);
      return {
        key,
        label: ranked[0][0],
        spellings: ranked.map(([name]) => name),
        toLink: [...g.toLink.values()],
        alreadyLinked: g.linked.size,
        missingFromCatalogue: g.missing.size,
      };
    })
    .sort((a, b) => b.toLink.length - a.toLink.length || a.label.localeCompare(b.label, "pt-BR"));
}

export interface Suggestion {
  /** Casou pelo cadastro (alias) ou tem exatamente este nome. */
  confident: Supplier | null;
  /** Nomes cadastrados que contêm ou estão contidos na grafia. Uma sugestão, nunca uma decisão. */
  candidates: Supplier[];
}

const MIN_OVERLAP = 3;

/**
 * Sugere, não decide: a tela só mostra o candidato e quem confirma é o operador.
 * Sem casamento difuso (a mesma regra do products-service): só "igual" ou "um contém o outro".
 */
export function suggestSuppliers(group: SheetSupplierGroup, suppliers: Supplier[], resolved: Map<string, Supplier>): Suggestion {
  for (const spelling of group.spellings) {
    const hit = resolved.get(fold(spelling));
    if (hit) return { confident: hit, candidates: [hit] };
  }

  const exact = suppliers.filter((s) => fold(s.name) === group.key);
  if (exact.length === 1) return { confident: exact[0], candidates: exact };

  const candidates = suppliers
    .filter((s) => {
      const name = fold(s.name);
      return group.key.length >= MIN_OVERLAP && name.length >= MIN_OVERLAP && (name.includes(group.key) || group.key.includes(name));
    })
    .slice(0, 4);

  return { confident: null, candidates };
}

export type Decision =
  | { kind: "link"; supplierId: number }
  | { kind: "create"; name: string; category: SupplierCategory }
  | { kind: "skip" };

export interface ReviewStep {
  group: SheetSupplierGroup;
  decision: Exclude<Decision, { kind: "skip" }>;
}

/** O que será gravado: grupos decididos (não "pular"), com a contagem de produtos afetados. */
export function planReview(groups: SheetSupplierGroup[], decisions: Map<string, Decision>): { steps: ReviewStep[]; products: number; suppliersToCreate: number } {
  const steps: ReviewStep[] = [];
  for (const group of groups) {
    const decision = decisions.get(group.key);
    if (!decision || decision.kind === "skip") continue;
    if (decision.kind === "create" && !decision.name.trim()) continue;
    steps.push({ group, decision });
  }

  return {
    steps,
    products: steps.reduce((sum, s) => sum + s.group.toLink.length, 0),
    suppliersToCreate: steps.filter((s) => s.decision.kind === "create").length,
  };
}
