import { validateEnv } from './env.validation'

const valid = {
  IAM_SERVICE_URL: 'http://iam:3000',
  STORES_SERVICE_URL: 'http://stores:3000',
  PRODUCTS_SERVICE_URL: 'http://products:3000',
  FINANCE_SERVICE_URL: 'http://finance:3000',
  INGESTION_SERVICE_URL: 'http://ingestion:3000',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'key',
  AWS_SECRET_ACCESS_KEY: 'secret',
  AWS_S3_BUCKET: 'agiliz-uploads',
}

describe('validateEnv', () => {
  it('accepts a configuration naming every upstream', () => {
    expect(() => validateEnv(valid)).not.toThrow()
  })

  it('throws when an upstream URL is missing — fail fast at boot', () => {
    const { IAM_SERVICE_URL: _omitted, ...withoutIam } = valid
    expect(() => validateEnv(withoutIam)).toThrow(/Invalid environment configuration/)
  })

  it('requires no DATABASE_URL — the gateway deliberately has no database', () => {
    expect(() => validateEnv(valid)).not.toThrow()
  })

  it('throws when the finance upstream is missing, like any other', () => {
    const { FINANCE_SERVICE_URL: _omitted, ...withoutFinance } = valid
    expect(() => validateEnv(withoutFinance)).toThrow(/Invalid environment configuration/)
  })

  it('rejects a malformed deadline rather than coercing it', () => {
    expect(() => validateEnv({ ...valid, UPSTREAM_DEADLINE_MS: 'soon' })).toThrow(/Invalid environment configuration/)
  })
})
