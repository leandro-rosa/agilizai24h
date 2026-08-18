import { plainToInstance } from 'class-transformer'
import { IsBooleanString, IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator'

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

  /** Required, not optional — see sales-service's env validation for why. */
  @IsBooleanString()
  WITH_KAFKA_BROKERS: string

  @IsString()
  @IsNotEmpty()
  STORES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  PRODUCTS_SERVICE_URL: string

  // Object storage: the raw uploads live here, never in Postgres.
  @IsString()
  @IsNotEmpty()
  AWS_REGION: string

  @IsString()
  @IsNotEmpty()
  AWS_ACCESS_KEY_ID: string

  @IsString()
  @IsNotEmpty()
  AWS_SECRET_ACCESS_KEY: string

  @IsString()
  @IsNotEmpty()
  AWS_S3_BUCKET: string

  @IsOptional()
  @IsString()
  AWS_S3_ENDPOINT?: string

  @IsOptional()
  @IsString()
  AWS_S3_FORCE_PATH_STYLE?: string

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
