import { plainToInstance } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator'

/**
 * Only variables this service actually reads. Validation throws at boot, so a
 * missing value fails immediately rather than on the first request needing it.
 *
 * No WITH_KAFKA_BROKERS: this service registers no queues, so it never imports
 * HoldItModule and never hits that DI hazard.
 */
class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string

  /** Upstreams this service reads to auto-fill the DRE. A 404 is "no data", never a failure. */
  @IsString()
  @IsNotEmpty()
  STORES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  SALES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  FINANCE_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  TREASURY_SERVICE_URL: string

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
