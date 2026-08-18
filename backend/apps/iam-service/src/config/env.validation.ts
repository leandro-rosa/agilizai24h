import { plainToInstance } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator'

/**
 * Only variables this service actually reads are declared here. Validation
 * throws at boot, so a missing or malformed value fails immediately instead of
 * surfacing on the first request that happens to need it.
 *
 * Note there is deliberately no WITH_KAFKA_BROKERS: this service registers no
 * queues, so it never loads HoldItModule and never hits that DI hazard.
 */
class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number

  /** Session lifetime in seconds. */
  @IsOptional()
  @IsInt()
  @Min(60)
  SESSION_TTL_SECONDS?: number

  /** Failed attempts tolerated before an account is throttled. */
  @IsOptional()
  @IsInt()
  @Min(1)
  AUTH_MAX_FAILED_ATTEMPTS?: number

  /** How long a throttled account stays locked, in seconds. Always clears on
   * its own — throttling must never require an administrator to undo. */
  @IsOptional()
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_SECONDS?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  ARGON2_MEMORY_COST?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  ARGON2_TIME_COST?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  ARGON2_PARALLELISM?: number
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true })
  const errors = validateSync(validated, { skipMissingProperties: false })

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`)
  }

  return validated
}
