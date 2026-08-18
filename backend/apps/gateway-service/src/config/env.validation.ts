import { plainToInstance } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator'

/**
 * No DATABASE_URL: the gateway is the one service without a database. Sessions
 * live in iam-service precisely so revocation is authoritative in one place;
 * duplicating them here would create a second source of truth that can
 * disagree with the first.
 */
class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  IAM_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  STORES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  PRODUCTS_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  INGESTION_SERVICE_URL: string

  // Object storage: the gateway holds the uploaded bytes already, so it writes
  // them once rather than re-streaming them to another service.
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

  /** Largest upload accepted, in bytes. */
  @IsOptional()
  @IsInt()
  @Min(1024)
  MAX_UPLOAD_BYTES?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number

  /** Per-call timeout handed to the HTTP client. */
  @IsOptional()
  @IsInt()
  @Min(100)
  UPSTREAM_TIMEOUT_MS?: number

  /**
   * Overall deadline per upstream call. Bounds @app/http-client's internal
   * retry loop, which would otherwise keep a timed-out call alive for ~40s.
   */
  @IsOptional()
  @IsInt()
  @Min(100)
  UPSTREAM_DEADLINE_MS?: number

  @IsOptional()
  @IsString()
  NODE_ENV?: string
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true })
  const errors = validateSync(validated, { skipMissingProperties: false })

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`)
  }

  return validated
}
