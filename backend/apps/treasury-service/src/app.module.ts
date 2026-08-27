import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { TREASURY_QUEUES } from '@app/treasury-ingestion-contracts'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { TreasuryModule } from './modules/treasury/treasury.module'
import { RawRowsWorker } from './modules/treasury/jobs/raw-rows.worker'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    TreasuryModule,
    // withKafkaBrokers passed explicitly, not left to the env var alone:
    // @app/hold-it defaults it to TRUE when unset, which pulls in a Kafka
    // broker requiring an ElasticsearchService nothing here provides, and
    // NestJS fails at startup. This service's first queue — see
    // add-treasury-statement-ingestion.
    HoldItModule.register([TREASURY_QUEUES.RAW_ROWS], { withKafkaBrokers: false }),
    HoldItModule.registerWorker({ processors: [RawRowsWorker] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
