/** Portuguese labels of the catalogue's category keys. A key outside the map is "Outros" — never hidden, never an error. */
const LABELS: Record<string, string> = {
  beverage: 'Bebidas',
  snack: 'Snacks',
  meal: 'Refeições',
  essential: 'Essenciais',
}

export const UNKNOWN_CATEGORY_LABEL = 'Outros'

/** The registry's name first (categories are managed data), then the old built-in label, then "Outros". */
export function categoryLabel(key: string | null | undefined, registryName?: string | null): string {
  return registryName || (key && LABELS[key]) || UNKNOWN_CATEGORY_LABEL
}
