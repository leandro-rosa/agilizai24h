import { plainToInstance } from 'class-transformer'
import { IsBooleanString, IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator'

/**
 * Only variables this service actually reads. Validation throws at boot, so a
 * missing value fails immediately rather than on the first request needing it.
 */
class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string

  @IsString()
  @IsNotEmpty()
  REDIS_QUEUE_HOST: string

  @IsInt()
  @Min(1)
  REDIS_QUEUE_PORT: number

  /**
   * Required, not optional, and validated as a boolean string.
   *
   * @app/hold-it defaults this to TRUE when unset, which pulls in
   * HoldItKafkaBroker, which needs an ElasticsearchService nothing provides —
   * and NestJS then fails at startup before the service ever listens
   * (add-treasury-statement-ingestion: this service's first queue consumer,
   * `TREASURY_QUEUES.RAW_ROWS`). The app also passes `withKafkaBrokers: false`
   * explicitly, so the value here is belt-and-braces: a deployment that
   * forgets it fails loudly at config validation rather than mysteriously
   * at DI.
   */
  @IsBooleanString()
  WITH_KAFKA_BROKERS: string

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true })
  const errors = validateSync(validated, { skipMissingProperties: false })

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`)
  }

  return validated
}
