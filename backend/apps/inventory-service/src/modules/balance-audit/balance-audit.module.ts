import { Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { BalanceAuditController } from './controllers/balance-audit.controller'
import { AuditSourceClient } from './services/audit-source.client'
import { BalanceAuditService } from './services/balance-audit.service'

@Module({
  imports: [HttpClientModule],
  controllers: [BalanceAuditController],
  providers: [AuditSourceClient, BalanceAuditService],
})
export class BalanceAuditModule {}
