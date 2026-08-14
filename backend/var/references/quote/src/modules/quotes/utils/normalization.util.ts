/**
 * Applies the subset of the brief's normalization rules
 * (frontend/src/domain/fixtures.ts's NORMALIZATION_RULES ids, mirrored in
 * backend/apps/quote/src/modules/quotes/constants/quote-config.ts) that are
 * meaningful on a single string value. `split`/`terms` (multi-code
 * splitting / per-term comparison) operate across values, not on one
 * value, and are intentionally not implemented here.
 */
export function applyNormalization(value: string, ruleIds: string[]): string {
  let result = value

  if (ruleIds.includes('trim')) {
    result = result.trim().replace(/\s+/g, ' ')
  }
  if (ruleIds.includes('accents')) {
    // Combining Diacritical Marks block (U+0300-U+036F), stripped after NFD decomposition.
    result = result.normalize('NFD').replace(/[̀-ͯ]/g, '')
  }
  if (ruleIds.includes('case')) {
    result = result.toLowerCase()
  }
  if (ruleIds.includes('hyphens')) {
    // Hyphen/dash variants (‐‑‒–—―) normalized to a plain ASCII hyphen.
    result = result.replace(/[‐-―]/g, '-')
  }
  if (ruleIds.includes('slashes')) {
    result = result.replace(/\\/g, '/')
  }
  if (ruleIds.includes('special')) {
    result = result.replace(/[^\w\s/-]/g, '')
  }
  if (ruleIds.includes('punct')) {
    result = result.replace(/[.,;:!?'"()[\]{}]/g, '')
  }
  if (ruleIds.includes('leading_zeros')) {
    result = result.replace(/^0+(?=\d)/, '')
  }

  return result.trim()
}
