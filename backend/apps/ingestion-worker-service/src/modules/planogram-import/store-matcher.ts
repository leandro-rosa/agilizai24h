export interface StoreRef {
  id: number
  name: string
}

export interface StoreMatch {
  storeId: number
  storeName: string
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The filenames are free text a person typed, not a structured key — matching
 * the longest store name that appears as a substring is what keeps "Ascenty -
 * SP03" from being shadowed by the shorter "Ascenty - ADM" when both happen to
 * be substrings of a longer, more specific name.
 */
export function matchStoreForFilename(filename: string, stores: StoreRef[]): StoreMatch | null {
  const body = normalize(filename.replace(/^Relatório_estoque/, '').replace(/\.xlsx$/i, ''))
  const matches = stores.filter((store) => body.includes(store.name))
  if (matches.length === 0) return null

  matches.sort((a, b) => b.name.length - a.name.length)
  return { storeId: matches[0].id, storeName: matches[0].name }
}
