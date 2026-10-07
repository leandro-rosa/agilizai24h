/** A six-digit numeric SKU, the PDV's internal code (`110023`). Other shapes (`REF-GUA-350`) are not part of the sequence. */
export const SIX_DIGIT_SKU = /^\d{6}$/

export interface NextSku {
  /** The number after the highest six-digit SKU; null while there is none to count from. A SUGGESTION: nothing is reserved. */
  suggested: string | null
  highest: string | null
  suggestion: true
}

/** The next number after the highest six-digit numeric SKU. 999999 has no next: no suggestion, the user types one. */
export function nextSku(skus: string[]): NextSku {
  const numbers = skus.filter(sku => SIX_DIGIT_SKU.test(sku)).map(Number)
  if (numbers.length === 0) return { suggested: null, highest: null, suggestion: true }

  const highest = Math.max(...numbers)

  return { suggested: highest < 999_999 ? String(highest + 1).padStart(6, '0') : null, highest: String(highest).padStart(6, '0'), suggestion: true }
}
