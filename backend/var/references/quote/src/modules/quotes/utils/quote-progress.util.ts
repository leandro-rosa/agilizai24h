/**
 * Shared by QuoteItemsService (manual decisions) and SearchMatchResultWorker
 * (automatic decisions above the score threshold) so a quote reaches
 * `reviewed` the same way regardless of which path reviewed its last item.
 * `reviewed` sits between `awaiting_review`/`partially_reviewed` and the
 * explicit human-triggered `completed` (`POST /:id/complete`, which
 * requires no item left `pending`) — before this fix, nothing ever set a
 * quote to `reviewed` automatically, leaving that vocabulary value
 * unreachable and `completeReview()`'s precondition ("no pending item")
 * satisfiable while the quote's own status still read
 * `awaiting_review`/`partially_reviewed`.
 */
export function deriveQuoteStatusOnReviewProgress(
  currentStatus: string | undefined,
  reviewedRows: number,
  totalRows: number,
): string | undefined {
  if (currentStatus !== 'awaiting_review' && currentStatus !== 'partially_reviewed') {
    return currentStatus
  }
  if (totalRows > 0 && reviewedRows >= totalRows) {
    return 'reviewed'
  }
  if (reviewedRows > 0) {
    return 'partially_reviewed'
  }
  return currentStatus
}
