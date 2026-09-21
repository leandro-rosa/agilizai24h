import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { DriveImportWorker } from './modules/drive-source/jobs/drive-import.worker'
import { DriveScanWorker } from './modules/drive-source/jobs/drive-scan.worker'
import { DriveValidateWorker } from './modules/drive-source/jobs/drive-validate.worker'
import { DriveSourceModule } from './modules/drive-source/drive-source.module'
import { IngestionModule } from './modules/ingestion/ingestion.module'
import { REGISTERED_QUEUES } from './registered-queues'
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
    DriveSourceModule,
    TreasuryIngestionModule,
    HoldItModule.register(REGISTERED_QUEUES, { withKafkaBrokers: false }),
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
        DriveScanWorker,
        DriveValidateWorker,
        DriveImportWorker,
      ],
    }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
