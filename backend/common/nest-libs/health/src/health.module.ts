import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'
import { PostgresHealthIndicator } from './custom/postgres.health'
import { HealthController } from './health.controller'

/**
 * Generic health-check module. PostgresHealthIndicator needs a provider
 * bound to POSTGRES_HEALTH_CLIENT (see ./custom/postgres.health) somewhere
 * in the application's module graph — this module does not provide one
 * itself, since it has no opinion on which database client the app uses.
 */
@Module({
  imports: [TerminusModule],
  providers: [PostgresHealthIndicator],
  controllers: [HealthController],
})
export class HealthModule {}
