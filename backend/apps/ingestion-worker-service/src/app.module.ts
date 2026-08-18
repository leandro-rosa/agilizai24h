import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { INGESTION_QUEUES } from '@app/ingestion-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { IngestionModule } from './modules/ingestion/ingestion.module'
import { INTERNAL_QUEUES } from './modules/ingestion/constants/file-types'
import { CostRowsWorker } from './modules/ingestion/jobs/cost-rows.worker'
import { ParseFileWorker } from './modules/ingestion/jobs/parse-file.worker'
import { StagedRowsWorker } from './modules/ingestion/jobs/staged-rows.worker'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    IngestionModule,
    HoldItModule.register(
      [
        // Internal: file → chunks → staged rows.
        INTERNAL_QUEUES.PARSE_FILE,
        INTERNAL_QUEUES.STAGED_ROWS,
        // Outbound: one batch per period to each owning service.
        INGESTION_QUEUES.SALES_ROWS,
        INGESTION_QUEUES.SUPPLY_ROWS,
        INGESTION_QUEUES.COST_ROWS,
      ],
      { withKafkaBrokers: false },
    ),
    HoldItModule.registerWorker({ processors: [ParseFileWorker, StagedRowsWorker, CostRowsWorker] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
