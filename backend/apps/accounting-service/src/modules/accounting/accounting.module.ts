import { Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { AccountingController } from './controllers/accounting.controller'
import { AccountingService } from './services/accounting.service'
import { UpstreamClient } from './services/upstream.client'

@Module({
  imports: [HttpClientModule],
  controllers: [AccountingController],
  providers: [AccountingService, UpstreamClient],
  exports: [AccountingService],
})
export class AccountingModule {}
