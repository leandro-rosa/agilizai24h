import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { validateEnv } from './config/env.validation'
import { CorrelationIdMiddleware } from './common/correlation-id.middleware'
import { UpstreamExceptionFilter } from './common/upstream-exception.filter'
import { AuthModule } from './modules/auth/auth.module'
import { GatewayHealthController } from './modules/health/health.controller'
import { SessionGuard } from './modules/auth/guards/session.guard'
import { DomainsModule } from './modules/domains/domains.module'
import { UpstreamModule } from './modules/upstream/upstream.module'
import type { MiddlewareConsumer, NestModule } from '@nestjs/common'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    UpstreamModule,
    AuthModule,
    DomainsModule,
  ],
  controllers: [GatewayHealthController],
  providers: [
    // Applied globally so a new route is protected by default. Opting out is
    // explicit, via @Public() — the safe direction for a trust boundary.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: UpstreamExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
