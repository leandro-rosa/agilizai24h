import { decideVersion } from './monthly-summary-version'

const base = new Date('2026-11-03T08:24:00Z')

describe('decideVersion', () => {
  it('first generation is version 1', () => {
    expect(decideVersion(null, base, 'h1')).toEqual({ action: 'create', version: 1 })
  })

  it('same base and same content reuses the version', () => {
    expect(decideVersion({ version: 1, base_at: base, content_hash: 'h1' }, base, 'h1')).toEqual({ action: 'reuse', version: 1 })
  })

  it('a reclosed month (new base_at) creates the next version', () => {
    expect(decideVersion({ version: 1, base_at: base, content_hash: 'h1' }, new Date('2026-11-05T10:00:00Z'), 'h1')).toEqual({ action: 'create', version: 2 })
  })

  it('same base but changed content (e.g. sales corrected) creates the next version', () => {
    expect(decideVersion({ version: 2, base_at: base, content_hash: 'h1' }, base, 'h2')).toEqual({ action: 'create', version: 3 })
  })
})
