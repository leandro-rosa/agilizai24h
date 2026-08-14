import { deriveQuoteStatusOnReviewProgress } from './quote-progress.util'

describe('deriveQuoteStatusOnReviewProgress', () => {
  it('transitions to reviewed once every row has been reviewed', () => {
    expect(deriveQuoteStatusOnReviewProgress('partially_reviewed', 3, 3)).toBe('reviewed')
    expect(deriveQuoteStatusOnReviewProgress('awaiting_review', 5, 5)).toBe('reviewed')
  })

  it('stays partially_reviewed while some but not all rows are reviewed', () => {
    expect(deriveQuoteStatusOnReviewProgress('awaiting_review', 2, 5)).toBe('partially_reviewed')
  })

  it('does not transition a quote in a status outside the review lifecycle', () => {
    expect(deriveQuoteStatusOnReviewProgress('completed', 5, 5)).toBe('completed')
    expect(deriveQuoteStatusOnReviewProgress('cancelled', 0, 5)).toBe('cancelled')
  })

  it('never reports reviewed for a quote with zero items', () => {
    expect(deriveQuoteStatusOnReviewProgress('awaiting_review', 0, 0)).toBe('awaiting_review')
  })
})
