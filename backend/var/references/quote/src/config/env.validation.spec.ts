import { validateEnv } from './env.validation'

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_QUEUE_HOST: 'localhost',
  REDIS_QUEUE_PORT: '6379',
  SEARCH_API_URL: 'http://search-api:3000',
}

describe('validateEnv', () => {
  it('accepts a minimal valid configuration', () => {
    const result = validateEnv(REQUIRED)

    expect(result.DATABASE_URL).toBe(REQUIRED.DATABASE_URL)
    expect(result.REDIS_QUEUE_HOST).toBe('localhost')
    expect(result.REDIS_QUEUE_PORT).toBe(6379)
    expect(result.MATCH_ITEM_WORKER_CONCURRENCY).toBe(10)
    expect(result.SEARCH_MATCH_RESULT_WORKER_CONCURRENCY).toBe(10)
    expect(result.SEARCH_MATCH_V2_ENABLED).toBe('true')
  })

  it('accepts quote worker concurrency up to 20 and rejects values outside bounds', () => {
    const result = validateEnv({
      ...REQUIRED,
      MATCH_ITEM_WORKER_CONCURRENCY: '20',
      SEARCH_MATCH_RESULT_WORKER_CONCURRENCY: '1',
    })
    expect(result.MATCH_ITEM_WORKER_CONCURRENCY).toBe(20)
    expect(result.SEARCH_MATCH_RESULT_WORKER_CONCURRENCY).toBe(1)
    expect(() => validateEnv({ ...REQUIRED, MATCH_ITEM_WORKER_CONCURRENCY: '21' })).toThrow()
    expect(() => validateEnv({ ...REQUIRED, SEARCH_MATCH_RESULT_WORKER_CONCURRENCY: '0' })).toThrow()
  })

  it('accepts optional PORT and NODE_ENV when valid', () => {
    const result = validateEnv({ ...REQUIRED, PORT: '4000', NODE_ENV: 'production' })

    expect(result.PORT).toBe(4000)
    expect(result.NODE_ENV).toBe('production')
  })

  it('accepts only explicit boolean strings for v2 emission', () => {
    expect(validateEnv({ ...REQUIRED, SEARCH_MATCH_V2_ENABLED: 'false' }).SEARCH_MATCH_V2_ENABLED).toBe('false')
    expect(() => validateEnv({ ...REQUIRED, SEARCH_MATCH_V2_ENABLED: 'yes' })).toThrow(/Invalid environment configuration/)
  })

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _DATABASE_URL, ...rest } = REQUIRED
    expect(() => validateEnv(rest)).toThrow(/Invalid environment configuration/)
  })

  it('throws when REDIS_QUEUE_HOST or REDIS_QUEUE_PORT is missing', () => {
    const { REDIS_QUEUE_HOST: _REDIS_QUEUE_HOST, ...rest } = REQUIRED
    expect(() => validateEnv(rest)).toThrow(/Invalid environment configuration/)
  })

  it('throws when SEARCH_API_URL is missing', () => {
    const { SEARCH_API_URL: _SEARCH_API_URL, ...rest } = REQUIRED
    expect(() => validateEnv(rest)).toThrow(/Invalid environment configuration/)
  })

  it('throws when PORT is not a positive integer', () => {
    expect(() => validateEnv({ ...REQUIRED, PORT: '-1' })).toThrow(/Invalid environment configuration/)
  })

  it('throws when NODE_ENV is not one of the known environments', () => {
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'staging' })).toThrow(/Invalid environment configuration/)
  })
})
