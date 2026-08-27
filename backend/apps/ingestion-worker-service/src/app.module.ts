import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { INGESTION_QUEUES } from '@app/ingestion-contracts'
import { TREASURY_QUEUES, TREASURY_SOURCE_QUEUES } from '@app/treasury-ingestion-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { IngestionModule } from './modules/ingestion/ingestion.module'
import { INTERNAL_QUEUES } from './modules/ingestion/constants/file-types'
import { CostRowsWorker } from './modules/ingestion/jobs/cost-rows.worker'
import { ParseFileWorker } from './modules/ingestion/jobs/parse-file.worker'
import { StagedRowsWorker } from './modules/ingestion/jobs/staged-rows.worker'
import { TreasuryIngestionModule } from './modules/treasury-ingestion/treasury-ingestion.module'
import { BradescoStatementWorker } from './modules/treasury-ingestion/jobs/bradesco-statement.worker'
import { C6InvoiceWorker } from './modules/treasury-ingestion/jobs/c6-invoice.worker'
import { C6StatementWorker } from './modules/treasury-ingestion/jobs/c6-statement.worker'
import { ItauStatementWorker } from './modules/treasury-ingestion/jobs/itau-statement.worker'
import { NubankStatementWorker } from './modules/treasury-ingestion/jobs/nubank-statement.worker'
import { PagBankStatementWorker } from './modules/treasury-ingestion/jobs/pagbank-statement.worker'
import { PagSeguroInvoiceWorker } from './modules/treasury-ingestion/jobs/pagseguro-invoice.worker'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    IngestionModule,
    TreasuryIngestionModule,
    HoldItModule.register(
      [
        // Internal: file → chunks → staged rows.
        INTERNAL_QUEUES.PARSE_FILE,
        INTERNAL_QUEUES.STAGED_ROWS,
        // Outbound: one batch per period to each owning service.
        INGESTION_QUEUES.SALES_ROWS,
        INGESTION_QUEUES.SUPPLY_ROWS,
        INGESTION_QUEUES.COST_ROWS,
        // Treasury: one inbound queue per source (this service's own fourth
        // sink family, add-treasury-statement-ingestion design D3), one
        // outbound queue to treasury-service regardless of which source
        // produced the rows.
        ...Object.values(TREASURY_SOURCE_QUEUES),
        TREASURY_QUEUES.RAW_ROWS,
      ],
      { withKafkaBrokers: false },
    ),
    HoldItModule.registerWorker({
      processors: [
        ParseFileWorker,
        StagedRowsWorker,
        CostRowsWorker,
        PagBankStatementWorker,
        C6StatementWorker,
        C6InvoiceWorker,
        PagSeguroInvoiceWorker,
        NubankStatementWorker,
        BradescoStatementWorker,
        ItauStatementWorker,
      ],
    }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
