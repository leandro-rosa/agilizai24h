/**
 * Candidates for an invoice line that matched no product, by the words of its description. These are SUGGESTIONS the operator
 * accepts or ignores — never applied by themselves (same rule as the product-name matching: a plausible wrong product gives a
 * plausible wrong cost). The measure (473ml, 1,5L, 200g) is compared on its own: a different volume is shown with a warning, not hidden.
 */
export interface Candidate {
  sku: string
  name: string
}

export interface Suggestion extends Candidate {
  /** 0..1, share of the words in common (Dice). */
  score: number
  /** Both names carry a measure and it differs ("473ml" vs "269ml"): probably another product. */
  measure_differs: boolean
}

/** Provisional: below this share of common words a candidate is noise. Owner has not reviewed it. */
export const MIN_SUGGESTION_SCORE = 0.4
export const MAX_SUGGESTIONS = 3

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** A measure normalised to ml or g, so "1,5 L" and "1500ml" are the same. */
export function measureOf(text: string): string | null {
  const match = /(\d+(?:[.,]\d+)?)\s?(ml|lt|l|kg|gr|g)\b/.exec(fold(text))
  if (!match) return null
  const value = Number(match[1].replace(',', '.'))
  const unit = match[2]
  if (unit === 'l' || unit === 'lt') return `${Math.round(value * 1000)}ml`
  if (unit === 'kg') return `${Math.round(value * 1000)}g`
  if (unit === 'gr') return `${Math.round(value)}g`

  return `${Math.round(value)}${unit}`
}

/** Pack markers and filler that say nothing about WHICH product it is. */
const NOISE = new Set(['cp', 'lt', 'fi', 'cx', 'un', 'und', 'unid', 'pack', 'pk', 'de', 'da', 'do', 'com', 'sem', 'c'])

export function wordsOf(text: string): string[] {
  return fold(text)
    .replace(/(\d+(?:[.,]\d+)?)\s?(ml|lt|l|kg|gr|g)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(word => word.length > 1 && !NOISE.has(word) && !/^0?\d{1,3}(un|p|pack|pk)?$/.test(word))
}

const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

export function suggestProducts(description: string, catalogue: Candidate[]): Suggestion[] {
  const words = wordsOf(description)
  if (words.length === 0) return []
  const measure = measureOf(description)

  return catalogue
    .map(product => {
      const other = wordsOf(product.name)
      const common = words.filter(word => other.some(candidate => same(word, candidate))).length
      const score = other.length === 0 ? 0 : (2 * common) / (words.length + other.length)
      const theirs = measureOf(product.name)

      return { sku: product.sku, name: product.name, score: Math.round(score * 100) / 100, measure_differs: measure !== null && theirs !== null && measure !== theirs }
    })
    .filter(suggestion => suggestion.score >= MIN_SUGGESTION_SCORE)
    .sort((a, b) => Number(a.measure_differs) - Number(b.measure_differs) || b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)
}
