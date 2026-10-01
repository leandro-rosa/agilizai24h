import { validateEnv } from './env.validation'

const valid = {
  DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
  REDIS_QUEUE_HOST: 'redis',
  REDIS_QUEUE_PORT: '6379',
  WITH_KAFKA_BROKERS: 'false',
  SUPPLY_SERVICE_URL: 'http://supply:3000',
  SALES_SERVICE_URL: 'http://sales:3000',
  PRODUCTS_SERVICE_URL: 'http://products:3000',
  STORES_SERVICE_URL: 'http://stores:3000',
}

describe('validateEnv', () => {
  it('accepts a complete configuration and converts the port numbers', () => {
    const result = validateEnv({ ...valid, PORT: '3000' })

    expect(result.REDIS_QUEUE_PORT).toBe(6379)
    expect(result.PORT).toBe(3000)
  })

  it.each(Object.keys(valid))('fails loudly when %s is missing', key => {
    const { [key]: _removed, ...rest } = valid as Record<string, string>

    expect(() => validateEnv(rest)).toThrow(/Invalid environment configuration/)
  })

  it('rejects a WITH_KAFKA_BROKERS that is not a boolean string — the DI-crash gotcha', () => {
    expect(() => validateEnv({ ...valid, WITH_KAFKA_BROKERS: 'maybe' })).toThrow(/WITH_KAFKA_BROKERS/)
  })
})
