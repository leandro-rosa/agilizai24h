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

  /**
   * Required and validated as a boolean string: @app/hold-it defaults this to
   * TRUE when unset, which needs an ElasticsearchService nothing provides and
   * makes NestJS fail at startup. A deployment that forgets it fails here,
   * loudly, instead of mysteriously inside DI.
   */
  @IsBooleanString()
  WITH_KAFKA_BROKERS: string

  /** The services this one reads. It never writes to any of them (design D1). */
  @IsString()
  @IsNotEmpty()
  SUPPLY_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  SALES_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  PRODUCTS_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  STORES_SERVICE_URL: string

  /** Purchases (read-only): what was bought, by SKU and month, for the supplier / product analysis. */
  @IsString()
  @IsNotEmpty()
  SUPPLIERS_SERVICE_URL: string

  /** Pricing (read-only): the acquirer fees in force and the P&L the operating allocation is read from. */
  @IsString()
  @IsNotEmpty()
  TREASURY_SERVICE_URL: string

  @IsString()
  @IsNotEmpty()
  ACCOUNTING_SERVICE_URL: string

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number

  /** Monthly refresh: first month of the history (YYYY-MM, default 2026-01) and the debounce window of the period events. */
  @IsOptional()
  @IsString()
  INTELLIGENCE_HISTORY_START?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  REFRESH_DEBOUNCE_SECONDS?: number
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true })
  const errors = validateSync(validated, { skipMissingProperties: false })

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`)
  }

  return validated
}
