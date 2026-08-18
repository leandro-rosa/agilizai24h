import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { POSTGRES_HEALTH_CLIENT } from '@app/health'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClientService } from './prisma-client.service'
import { ReconciliationRepository } from './repositories/reconciliation.repository'
import { ReconciliationLossRepository } from './repositories/reconciliation-loss.repository'
import { UnvaluedSkuRepository } from './repositories/unvalued-sku.repository'

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
    ReconciliationRepository,
    ReconciliationLossRepository,
    UnvaluedSkuRepository,
  ],
  exports: [
    PrismaClientService,
    POSTGRES_HEALTH_CLIENT,
    ReconciliationRepository,
    ReconciliationLossRepository,
    UnvaluedSkuRepository,
  ],
})
export class DbClientModule {}
