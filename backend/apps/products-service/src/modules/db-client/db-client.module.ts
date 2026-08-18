import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { POSTGRES_HEALTH_CLIENT } from '@app/health'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClientService } from './prisma-client.service'
import { CostVersionRepository } from './repositories/cost-version.repository'
import { NameOverrideRepository } from './repositories/name-override.repository'
import { ProductRepository } from './repositories/product.repository'

const repositories = [ProductRepository, CostVersionRepository, NameOverrideRepository]

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
    ...repositories,
    { provide: POSTGRES_HEALTH_CLIENT, useExisting: PrismaClientService },
  ],
  exports: [PrismaClientService, ...repositories, POSTGRES_HEALTH_CLIENT],
})
export class DbClientModule {}
