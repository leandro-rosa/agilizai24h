/**
 * Folds a product name for matching: case, accents and whitespace.
 *
 * Pure and side-effect free so the folding rules can be tested exhaustively
 * without touching a database. Deliberately NOT fuzzy — see the module's
 * CLAUDE.md: a near-match binding "Guaraná 350ml" to "Guaraná 600ml" produces
 * a plausible, wrong cost that nobody notices, which is worse than an
 * unmatched SKU that is loud and gets fixed.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    // Strip combining diacritical marks left behind by the NFD decomposition.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
