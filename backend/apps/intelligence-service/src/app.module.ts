import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { DbClientModule } from './modules/db-client/db-client.module'
import { SourcesModule } from './modules/sources/sources.module'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    DbClientModule,
    SourcesModule,
    // HoldItModule (queues and the run worker) is registered with the runs group of
    // add-intelligence-engine-phase1; the env it needs is already validated.
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
