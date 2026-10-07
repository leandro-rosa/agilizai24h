"use client";

import { useEffect } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSuggestClassificationMutation, type CategoryRow } from "@/lib/api/products";
import { activeCategories, categoryName, chooseAlternative, chooseCategory, chooseSubcategory, subcategoriesFor, applySuggestion, type ClassificationState } from "@/lib/products/taxonomy";

const NONE = "__none";

/**
 * Suggests the classification from the NAME while it is typed (deterministic keywords over the managed taxonomy). A manual choice is never overwritten:
 * once the person picks a category or subcategory, later edits of the name leave it alone. It never creates a category.
 */
export function useNameClassification(name: string, setState: (update: (previous: ClassificationState) => ClassificationState) => void, enabled = true) {
  const [suggest] = useSuggestClassificationMutation();

  useEffect(() => {
    if (!enabled || !name.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await suggest({ name }).unwrap();
        if (!cancelled) setState((previous) => applySuggestion(previous, result));
      } catch {
        // Without an answer nothing is suggested; the person picks by hand.
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, enabled, suggest, setState]);
}

/** Category and subcategory selects over the managed taxonomy, with the "suggested automatically" marker and the alternatives of an ambiguous name. */
export function CategoryFields({
  categories,
  state,
  onChange,
  currentSubcategory,
  categoryLabel = "Categoria",
  subcategoryLabel = "Subcategoria",
}: {
  categories: CategoryRow[] | undefined;
  state: ClassificationState;
  onChange: (state: ClassificationState) => void;
  /** A subcategory the product already has, kept visible even if it was inactivated since. */
  currentSubcategory?: string | null;
  categoryLabel?: string;
  subcategoryLabel?: string;
}) {
  const offered = activeCategories(categories);
  // A product keeps an inactive category it already has: it is shown, not offered to others.
  const inactiveCurrent = state.category && !offered.some((row) => row.key === state.category) ? state.category : null;
  const subs = subcategoriesFor(categories, state.category || null, currentSubcategory);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {categoryLabel}
          <Select value={state.category || NONE} onValueChange={(value) => onChange(chooseCategory(state, value === NONE ? "" : value))}>
            <SelectTrigger aria-label={categoryLabel}>
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {state.category === "" && <SelectItem value={NONE}>Escolha</SelectItem>}
              {inactiveCurrent && <SelectItem value={inactiveCurrent}>{categoryName(inactiveCurrent, categories)} (inativa)</SelectItem>}
              {offered.map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {subcategoryLabel}
          <Select value={state.subcategory || NONE} onValueChange={(value) => onChange(chooseSubcategory(state, value === NONE ? "" : value))} disabled={!state.category}>
            <SelectTrigger aria-label={subcategoryLabel}>
              <SelectValue placeholder={state.category ? "Sem subcategoria" : "Escolha a categoria"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem subcategoria</SelectItem>
              {subs.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {state.source === "suggested" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tone="attention">Sugerida automaticamente</StatusBadge>
          pelo nome do produto — confira e altere se preciso.
        </p>
      )}
      {state.alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="group" aria-label="Sugestões de classificação">
          <span>O nome serve para mais de uma classificação. Qual?</span>
          {state.alternatives.map((candidate) => (
            <button
              key={`${candidate.categoryKey}|${candidate.subcategory}`}
              type="button"
              className="rounded-md border px-2 py-1 text-foreground hover:bg-muted"
              onClick={() => onChange(chooseAlternative(state, candidate))}
            >
              {candidate.categoryName}
              {candidate.subcategory ? ` > ${candidate.subcategory}` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
