import { Inject, Injectable, Optional } from '@nestjs/common'
import { HealthIndicatorResult } from '@nestjs/terminus'

/** Injection token for whatever Postgres client the consuming app wires up. */
export const POSTGRES_HEALTH_CLIENT = Symbol('POSTGRES_HEALTH_CLIENT')

/**
 * Minimal shape PostgresHealthIndicator needs — deliberately not coupled to
 * Prisma or any specific ORM. Consuming apps bind POSTGRES_HEALTH_CLIENT to
 * their own database client (e.g. a Prisma client) as long as it exposes
 * this method.
 */
export interface PostgresHealthClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

@Injectable()
export class PostgresHealthIndicator {
  constructor(@Optional() @Inject(POSTGRES_HEALTH_CLIENT) private readonly client?: PostgresHealthClient) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.client) {
      return {
        [key]: {
          status: 'down',
          message: `No provider bound to POSTGRES_HEALTH_CLIENT — the consuming app must supply one.`,
        },
      }
    }

    try {
      const result = await this.client.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`
      return {
        [key]: {
          status: 'up',
          database: result[0]?.current_database,
        },
      }
    } catch (error) {
      return {
        [key]: {
          status: 'down',
          message: (error as Error).message,
        },
      }
    }
  }
}
