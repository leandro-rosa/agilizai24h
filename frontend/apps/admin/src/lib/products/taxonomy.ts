import type { CategoryRow, ClassificationCandidate, ClassificationResult } from "@/lib/api/products";

/** Names the screens used before categories became managed data. Only a fallback while the list loads or if it cannot be read. */
const FALLBACK_NAMES: Record<string, string> = { meal: "Refeição", snack: "Lanche", beverage: "Bebida", essential: "Essencial" };

/**
 * The names the app last read from the managed list, for code that has no hook to ask (the sales insights build their sentences deep inside pure
 * functions). `TaxonomySync` fills it as soon as the list loads; until then the old names apply.
 */
let registry = new Map<string, string>();
export function registerCategoryNames(rows: CategoryRow[] | undefined): void {
  registry = new Map((rows ?? []).map((row) => [row.key, row.name]));
}

/** The category's name from the managed list; the key's old name, then the key itself — a category is never hidden or turned into "Outros". */
export function categoryName(key: string | null | undefined, rows: CategoryRow[] | undefined): string {
  if (!key) return "Sem categoria";

  return rows?.find((row) => row.key === key)?.name ?? registry.get(key) ?? FALLBACK_NAMES[key] ?? key;
}

/** What a form offers for a NEW choice: active categories only. A product that already has an inactive one keeps showing it by name. */
export const activeCategories = (rows: CategoryRow[] | undefined): CategoryRow[] => (rows ?? []).filter((row) => row.status === "active");

/** Subcategories of ONE category (never of another); inactive ones are left out unless it is the one the product already has. */
export function subcategoriesFor(rows: CategoryRow[] | undefined, key: string | null, current?: string | null): string[] {
  const category = rows?.find((row) => row.key === key);
  if (!category) return [];
  const names = category.subcategories.filter((sub) => sub.status === "active").map((sub) => sub.name);

  return current && !names.some((name) => name.toLowerCase() === current.toLowerCase()) ? [...names, current] : names;
}

/** Folded comparison for names (case and accents), the same rule the backend uses for duplicates. */
export const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Where a form's category and subcategory came from. `manual` is what the person chose and is NEVER overwritten by a later suggestion; `suggested`
 * came from the name and is replaced when the name changes; `none` is nothing yet. `alternatives` are the options when the name was ambiguous.
 */
export interface ClassificationState {
  category: string;
  subcategory: string;
  source: "none" | "suggested" | "manual";
  alternatives: ClassificationCandidate[];
}

export const EMPTY_CLASSIFICATION: ClassificationState = { category: "", subcategory: "", source: "none", alternatives: [] };

/** The person picked a category or subcategory: from then on the name does not change it. Picking another category clears a subcategory that does not belong to it. */
export function chooseCategory(state: ClassificationState, category: string): ClassificationState {
  return { category, subcategory: category === state.category ? state.subcategory : "", source: "manual", alternatives: [] };
}

export function chooseSubcategory(state: ClassificationState, subcategory: string): ClassificationState {
  return { ...state, subcategory, source: "manual", alternatives: [] };
}

/** Takes one of the offered alternatives: a deliberate choice, so it counts as manual. */
export function chooseAlternative(state: ClassificationState, candidate: ClassificationCandidate): ClassificationState {
  return { category: candidate.categoryKey, subcategory: candidate.subcategory ?? "", source: "manual", alternatives: [] };
}

/**
 * Applies the answer of the classifier for the current name. A manual choice is kept as it is. A clear answer fills the form as suggested; an ambiguous
 * one leaves it pending and offers the alternatives; no answer drops what an earlier name had suggested (the name changed) and keeps nothing invented.
 */
export function applySuggestion(state: ClassificationState, result: ClassificationResult): ClassificationState {
  if (state.source === "manual") return state;
  if (result.confidence === "clear" && result.best) return { category: result.best.categoryKey, subcategory: result.best.subcategory ?? "", source: "suggested", alternatives: [] };
  if (result.confidence === "ambiguous") return { category: "", subcategory: "", source: "none", alternatives: result.alternatives };

  return EMPTY_CLASSIFICATION;
}

/** Cost per SOLD unit = package cost ÷ units per package, to the centavo (the rule the invoice import uses). `null` when either is not a valid positive number. */
export function unitCostCents(packageCostCents: number | null, factor: number | null): number | null {
  if (packageCostCents === null || factor === null) return null;
  if (!Number.isInteger(factor) || factor < 1 || !Number.isFinite(packageCostCents) || packageCostCents <= 0) return null;

  return Math.round(packageCostCents / factor);
}

/** Keywords as one editable line ("monster, energy, red bull") and back; empty pieces are dropped and repeats (case/accent-insensitive) kept once. */
export const keywordsToText = (keywords: string[]): string => keywords.join(", ");

export function textToKeywords(text: string): string[] {
  const seen = new Set<string>();

  return text
    .split(/[,;\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => {
      const key = fold(piece);
      if (!key || seen.has(key)) return false;
      seen.add(key);

      return true;
    });
}
