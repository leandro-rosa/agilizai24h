import { validateEnv } from './env.validation'

describe('validateEnv', () => {
  it('accepts a minimal valid configuration', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/db' })).not.toThrow()
  })

  it('throws when DATABASE_URL is missing — fail fast at boot', () => {
    expect(() => validateEnv({})).toThrow(/Invalid environment configuration/)
  })

  it('throws on a malformed numeric value rather than coercing it silently', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x', PORT: 'not-a-port' })).toThrow(
      /Invalid environment configuration/,
    )
  })

  it('rejects a session lifetime below the allowed minimum', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x', SESSION_TTL_SECONDS: 5 })).toThrow(
      /Invalid environment configuration/,
    )
  })
})
