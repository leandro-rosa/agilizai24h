import { validateEnv } from './env.validation'

const valid = {
  DATABASE_URL: 'postgresql://u:p@h:5432/db',
  REDIS_QUEUE_HOST: 'redis',
  REDIS_QUEUE_PORT: 6379,
  WITH_KAFKA_BROKERS: 'false',
}

describe('validateEnv', () => {
  it('accepts a valid configuration', () => {
    expect(() => validateEnv(valid)).not.toThrow()
  })

  it('REQUIRES WITH_KAFKA_BROKERS rather than letting it default', () => {
    // Unset defaults to TRUE inside @app/hold-it, which pulls in a Kafka broker
    // needing an ElasticsearchService nothing provides — NestJS then fails at
    // startup. Failing here instead makes a misconfigured deployment loud.
    const { WITH_KAFKA_BROKERS: _omitted, ...withoutGuard } = valid
    expect(() => validateEnv(withoutGuard)).toThrow(/Invalid environment configuration/)
  })

  it('rejects a non-boolean guard value', () => {
    expect(() => validateEnv({ ...valid, WITH_KAFKA_BROKERS: 'nope' })).toThrow(/Invalid environment configuration/)
  })

  it('requires the Redis connection, since this service consumes a queue', () => {
    const { REDIS_QUEUE_HOST: _omitted, ...withoutRedis } = valid
    expect(() => validateEnv(withoutRedis)).toThrow(/Invalid environment configuration/)
  })

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid
    expect(() => validateEnv(withoutDb)).toThrow(/Invalid environment configuration/)
  })
})
