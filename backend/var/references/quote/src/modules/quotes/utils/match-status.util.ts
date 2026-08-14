/**
 * Buckets a set of scored candidates into one of the quality-facing
 * MatchStatus values (frontend/src/domain/model.ts). Shared by MatchItemWorker
 * (spreadsheet-origin matching) and PartnerIntakeService (partner-origin
 * quotes arrive with candidates already attached) so the two origins
 * classify match quality identically. Deliberately does not produce
 * 'invalid'/'insufficient'/'duplicate' — those describe problems with the
 * input row itself, not the candidate set, and are decided by the caller
 * before candidates are even looked up.
 */
export function deriveMatchStatus(candidates: Array<{ matchScore: number }>): string {
  if (candidates.length === 0) {
    return 'not_found'
  }
  if (candidates.length > 1) {
    return 'multiple'
  }

  const [{ matchScore }] = candidates
  if (matchScore >= 95) {
    return 'exact'
  }
  if (matchScore >= 75) {
    return 'strong'
  }
  return 'approximate'
}

export function topCandidate<T extends { matchScore: number }>(candidates: T[]): T | null {
  if (!candidates.length) {
    return null
  }
  return [...candidates].sort((a, b) => b.matchScore - a.matchScore)[0]
}
