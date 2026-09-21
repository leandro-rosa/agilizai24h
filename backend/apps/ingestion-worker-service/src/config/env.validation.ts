import { plainToInstance } from 'class-transformer'
import { IsBooleanString, IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator'
import { loadDriveConfig } from '../modules/drive-source/config/drive.config'

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

  // Google Drive source (add-drive-ingestion-source). Every one is optional: with
  // none set the feature is inert. They stay strings here and are parsed, with
  // the documented defaults and the all-or-nothing rule, by loadDriveConfig —
  // which also fails startup when the setup is half-done.
  @IsOptional() @IsString() GOOGLE_DRIVE_ROOT_FOLDER_ID?: string
  @IsOptional() @IsString() GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?: string
  @IsOptional() @IsString() GOOGLE_SERVICE_ACCOUNT_FILE?: string
  @IsOptional() @IsString() DRIVE_SCAN_CRON?: string
  @IsOptional() @IsString() DRIVE_AUTO_VALIDATE?: string
  @IsOptional() @IsString() DRIVE_MAX_FILE_BYTES?: string
  @IsOptional() @IsString() DRIVE_INCLUDE_PATTERNS?: string
  @IsOptional() @IsString() DRIVE_SYNTHETIC_PATTERN?: string
  @IsOptional() @IsString() DRIVE_PERIOD_MATCH_MIN_SHARE?: string
  @IsOptional() @IsString() DRIVE_WEEKDAY_OPEN_MIN_SHARE?: string
  @IsOptional() @IsString() DRIVE_COVERAGE_MIN_POOLED?: string
  @IsOptional() @IsString() DRIVE_COVERAGE_MIN_STORE?: string
  @IsOptional() @IsString() DRIVE_EDGE_TOLERANCE_DAYS?: string
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true })
  const errors = validateSync(validated, { skipMissingProperties: false })

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`)
  }

  // Throws — naming the variable, never the credential — when the Drive setup is
  // half-done or a value cannot be used; a no-op when nothing Drive-related is set.
  loadDriveConfig(validated as unknown as Record<string, unknown>)

  return validated
}
