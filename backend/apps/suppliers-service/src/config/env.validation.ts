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

  /** The services this one reads (never writes): sold units for the weekly settlement, and the catalogue to validate SKUs. */
  @IsString()
  @IsNotEmpty()
  SALES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  PRODUCTS_SERVICE_URL: string

  /**
   * Outgoing e-mail (orders to suppliers). All optional: with no SMTP_HOST the panel reports "e-mail not configured" and sends
   * nothing. In development point it at the local mail catcher; real credentials are the owner's to set.
   */
  @IsOptional()
  @IsString()
  SMTP_HOST?: string

  @IsOptional()
  @IsString()
  SMTP_PORT?: string

  @IsOptional()
  @IsString()
  SMTP_USER?: string

  @IsOptional()
  @IsString()
  SMTP_PASS?: string

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string

  /** The sender shown to the supplier. Required whenever SMTP_HOST is set. */
  @IsOptional()
  @IsString()
  MAIL_FROM?: string

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
  if (validated.SMTP_HOST && !validated.MAIL_FROM) throw new Error('Invalid environment configuration: MAIL_FROM is required when SMTP_HOST is set')

  return validated
}
