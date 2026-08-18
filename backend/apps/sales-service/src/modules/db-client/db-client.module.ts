import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { POSTGRES_HEALTH_CLIENT } from '@app/health'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClientService } from './prisma-client.service'
import { SalesRecordRepository } from './repositories/sales-record.repository'

@Global()
@Module({
  providers: [
    {
      provide: PrismaPg,
      useFactory: (config: ConfigService) =>
        new PrismaPg({ connectionString: config.getOrThrow<string>('DATABASE_URL') }),
      inject: [ConfigService],
    },
    PrismaClientService,
    SalesRecordRepository,
    { provide: POSTGRES_HEALTH_CLIENT, useExisting: PrismaClientService },
  ],
  exports: [PrismaClientService, SalesRecordRepository, POSTGRES_HEALTH_CLIENT],
})
export class DbClientModule {}
