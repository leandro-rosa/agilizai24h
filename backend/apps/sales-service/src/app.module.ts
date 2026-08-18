import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { INGESTION_QUEUES } from '@app/ingestion-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { SalesModule } from './modules/sales/sales.module'
import { SalesRowsWorker } from './modules/sales/jobs/sales-rows.worker'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    SalesModule,
    // withKafkaBrokers is passed explicitly rather than relying on the env var
    // alone: @app/hold-it defaults it to TRUE when unset, which pulls in a
    // Kafka broker requiring an ElasticsearchService nothing provides, and
    // NestJS then fails at startup. Passing it here means the service cannot
    // be broken by a missing env var; the env var is still required by config
    // validation so a misconfigured deployment fails loudly rather than at DI.
    HoldItModule.register([INGESTION_QUEUES.SALES_ROWS], { withKafkaBrokers: false }),
    // Workers live in their own dynamic module and do not import SalesModule —
    // which is why SalesModule is @Global().
    HoldItModule.registerWorker({ processors: [SalesRowsWorker] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
