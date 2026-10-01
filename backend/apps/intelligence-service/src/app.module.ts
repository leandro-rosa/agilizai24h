import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { HoldItModule } from '@app/hold-it'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { BaselineModule } from './modules/baseline/baseline.module'
import { FlagsModule } from './modules/flags/flags.module'
import { ParametersModule } from './modules/parameters/parameters.module'
import { EngineStoreWorker } from './modules/runs/engine-store.worker'
import { INTELLIGENCE_QUEUES } from './modules/runs/runs.constants'
import { RunsModule } from './modules/runs/runs.module'
import { ScheduleModule } from './modules/schedule/schedule.module'
import { SourcesModule } from './modules/sources/sources.module'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    SourcesModule,
    ParametersModule,
    ScheduleModule,
    BaselineModule,
    FlagsModule,
    RunsModule,
    // withKafkaBrokers is explicit for the same reason as everywhere else: the default is true
    // and crashes NestJS at startup.
    HoldItModule.register([INTELLIGENCE_QUEUES.ENGINE_STORE], { withKafkaBrokers: false }),
    HoldItModule.registerWorker({ processors: [EngineStoreWorker] }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
