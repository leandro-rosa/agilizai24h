import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { POSTGRES_HEALTH_CLIENT } from '@app/health'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClientService } from './prisma-client.service'

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
    { provide: POSTGRES_HEALTH_CLIENT, useExisting: PrismaClientService },
  ],
  exports: [PrismaClientService, POSTGRES_HEALTH_CLIENT],
})
export class DbClientModule {}
