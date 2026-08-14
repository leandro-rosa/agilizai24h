import { createQuoteJobEnvelope } from './quote-job-envelope'

describe('createQuoteJobEnvelope', () => {
  it('wraps a payload with schemaVersion, quoteId and an ISO timestamp', () => {
    const envelope = createQuoteJobEnvelope(1, { foo: 'bar' })

    expect(envelope.schemaVersion).toBe(1)
    expect(envelope.quoteId).toBe(1)
    expect(envelope.payload).toEqual({ foo: 'bar' })
    expect(new Date(envelope.emittedAt).toISOString()).toBe(envelope.emittedAt)
  })

  it('round-trips through JSON serialization unchanged', () => {
    const envelope = createQuoteJobEnvelope(2, { itemId: 1 })
    const roundTripped = JSON.parse(JSON.stringify(envelope))

    expect(roundTripped).toEqual(envelope)
  })
})
