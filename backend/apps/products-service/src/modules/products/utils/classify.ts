import { normalizeName } from './normalize-name'

/** The taxonomy a name is matched against: only ACTIVE categories and subcategories take part. */
export interface TaxonomyCategory {
  key: string
  name: string
  keywords: string[]
  subcategories: { id: number; name: string; keywords: string[] }[]
}

export interface Candidate {
  categoryKey: string
  categoryName: string
  subcategory: string | null
  /** The words of the name that matched. */
  matched: string[]
  score: number
}

export interface Classification {
  /** `clear`: one winner; `ambiguous`: a tie between different targets (none is applied); `none`: nothing matched. */
  confidence: 'clear' | 'ambiguous' | 'none'
  best: Candidate | null
  alternatives: Candidate[]
}

/** A word or phrase is matched on word boundaries of the folded name, so "cha" does not match "chocolate". */
function occurs(foldedName: string, keyword: string): boolean {
  const folded = normalizeName(keyword)
  if (!folded) return false

  return ` ${foldedName.replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${folded.replace(/[^a-z0-9]+/g, ' ')} `)
}

const wordsOf = (keyword: string): number => normalizeName(keyword).split(/\s+/).filter(Boolean).length

function scoreOf(foldedName: string, keywords: string[]): { score: number; matched: string[] } {
  const matched = [...new Set(keywords.map(k => k.trim()).filter(k => k && occurs(foldedName, k)))]

  // A longer phrase is stronger evidence than one word.
  return { score: matched.reduce((sum, keyword) => sum + wordsOf(keyword), 0), matched }
}

/**
 * Deterministic classification from keywords and synonyms; it never creates a category and never learns. A subcategory's own name counts as one of
 * its keywords, and a subcategory match implies its category. The category's own keywords only fill the category (the subcategory stays pending).
 * Candidates tie → ambiguous: the alternatives are returned and nothing is chosen.
 */
export function classifyName(name: string, taxonomy: TaxonomyCategory[]): Classification {
  const folded = normalizeName(name)
  if (!folded) return { confidence: 'none', best: null, alternatives: [] }

  const candidates: Candidate[] = []
  for (const category of taxonomy) {
    for (const sub of category.subcategories) {
      const { score, matched } = scoreOf(folded, [sub.name, ...sub.keywords])
      if (score > 0) candidates.push({ categoryKey: category.key, categoryName: category.name, subcategory: sub.name, matched, score: score + 0.5 })
    }
    const own = scoreOf(folded, [category.name, ...category.keywords])
    if (own.score > 0) candidates.push({ categoryKey: category.key, categoryName: category.name, subcategory: null, matched: own.matched, score: own.score })
  }
  if (candidates.length === 0) return { confidence: 'none', best: null, alternatives: [] }

  candidates.sort((a, b) => b.score - a.score || a.categoryName.localeCompare(b.categoryName) || (a.subcategory ?? '').localeCompare(b.subcategory ?? ''))
  const [top, ...rest] = candidates
  const tied = rest.filter(candidate => candidate.score === top.score)

  // A category-only candidate that the winner's category already covers is not an alternative.
  const different = (a: Candidate, b: Candidate) => a.categoryKey !== b.categoryKey || a.subcategory !== b.subcategory

  if (tied.length > 0) {
    const alternatives = [top, ...tied].filter((candidate, index, all) => all.findIndex(other => !different(other, candidate)) === index)
    // Same category, one with the subcategory: the subcategory match (the extra 0.5) already wins above; a true tie here is between different targets.
    return { confidence: 'ambiguous', best: null, alternatives: alternatives.slice(0, 4) }
  }

  return { confidence: 'clear', best: top, alternatives: rest.filter(candidate => different(candidate, top) && candidate.categoryKey !== top.categoryKey).slice(0, 3) }
}
