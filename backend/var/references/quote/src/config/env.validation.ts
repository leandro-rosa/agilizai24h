import { plainToInstance } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, IsNotEmpty, Max, Min, validateSync } from 'class-validator'

enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

enum BooleanString {
  False = 'false',
  True = 'true',
}

/**
 * Env vars actually consumed by apps/quote today. Extend this class as more
 * modules are wired into AppModule — do not validate vars nothing reads yet.
 */
class EnvironmentVariables {
  @IsOptional()
  @IsEnum(BooleanString)
  SEARCH_MATCH_V2_ENABLED: BooleanString = BooleanString.True

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  MATCH_ITEM_WORKER_CONCURRENCY: number = 10

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  SEARCH_MATCH_RESULT_WORKER_CONCURRENCY: number = 10

  @IsOptional()
  @IsEnum(Environment)
  NODE_ENV?: Environment

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT?: number

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
   * backend/apps/search's base URL — first outbound HTTP dependency from
   * this app onto that one (everything else between them is BullMQ, see
   * @app/quote-search-match). Used only by SearchCatalogService to
   * re-fetch a quote item's matched product fresh when generating an
   * export (quote-item-redecision-and-export-config).
   */
  @IsString()
  @IsNotEmpty()
  SEARCH_API_URL: string
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true })
  const errors = validateSync(validated, { skipMissingProperties: false })

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`)
  }

  return validated
}
