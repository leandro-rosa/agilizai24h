/**
 * The synthetic-data guard, the same marker the Drive ingestion and the admin
 * use: anything named synthetic never takes part in an analysis of real data.
 */
const SYNTHETIC_MARKER = /sintetic|synthetic|\[teste\]/

export function isSynthetic(name: string | null | undefined): boolean {
  if (name == null) return false

  const folded = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return SYNTHETIC_MARKER.test(folded)
}
