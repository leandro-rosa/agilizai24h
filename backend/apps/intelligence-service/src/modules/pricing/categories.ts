/** Portuguese labels of the catalogue's category keys. A key outside the map is "Outros" — never hidden, never an error. */
const LABELS: Record<string, string> = {
  beverage: 'Bebidas',
  snack: 'Snacks',
  meal: 'Refeições',
  essential: 'Essenciais',
}

export const UNKNOWN_CATEGORY_LABEL = 'Outros'

export function categoryLabel(key: string | null | undefined): string {
  return (key && LABELS[key]) || UNKNOWN_CATEGORY_LABEL
}
