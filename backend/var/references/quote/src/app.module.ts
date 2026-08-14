import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthModule } from '@app/health'
import { validateEnv } from './config/env.validation'
import { DbClientModule } from './modules/db-client/db-client.module'
import { QuotesModule } from './modules/quotes/quotes.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DbClientModule,
    HealthModule,
    QuotesModule,
  ],
})
export class AppModule {}
