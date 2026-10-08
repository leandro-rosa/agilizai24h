/** A six-digit numeric SKU, the PDV's internal code (`110023`). Other shapes (`REF-GUA-350`) are not part of the sequence. */
export const SIX_DIGIT_SKU = /^\d{6}$/

export interface NextSku {
  /** The number the next registration will probably get; null when the six-digit range is used up. A FORECAST: nothing is reserved until the product is saved. */
  suggested: string | null
  /** The last number handed out or seen by the sequence. */
  highest: string | null
  suggestion: true
  forecast?: true
}
