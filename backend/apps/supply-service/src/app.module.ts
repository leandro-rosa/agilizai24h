import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { INGESTION_QUEUES } from '@app/ingestion-contracts'
import { PERIOD_EVENT_QUEUES } from '@app/period-events-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { SupplyModule } from './modules/supply/supply.module'
import { SupplyRowsWorker } from './modules/supply/jobs/supply-rows.worker'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    SupplyModule,
    // Consumes the ingestion queue and publishes the period event, so both are
    // registered. withKafkaBrokers is explicit for the same reason as in
    // sales-service: the default is true and crashes NestJS at startup.
    HoldItModule.register([INGESTION_QUEUES.SUPPLY_ROWS, PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED], {
      withKafkaBrokers: false,
    }),
    HoldItModule.registerWorker({ processors: [SupplyRowsWorker] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
