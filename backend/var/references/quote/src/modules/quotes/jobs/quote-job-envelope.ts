export const QUOTE_PROCESS_UPLOAD_QUEUE = 'quote.process-upload'
export const QUOTE_MATCH_ITEM_QUEUE = 'quote.match-item'
export const QUOTE_GENERATE_EXPORT_QUEUE = 'quote.generate-export'

/**
 * Versioned envelope for every job quote publishes via hold-it. Bump
 * schemaVersion (and handle both versions in the corresponding worker,
 * Fase 9) if payload shapes ever need a breaking change.
 */
export interface QuoteJobEnvelope<T> {
  schemaVersion: 1
  quoteId: number
  emittedAt: string
  payload: T
}

export function createQuoteJobEnvelope<T>(quoteId: number, payload: T): QuoteJobEnvelope<T> {
  return {
    schemaVersion: 1,
    quoteId,
    emittedAt: new Date().toISOString(),
    payload,
  }
}
