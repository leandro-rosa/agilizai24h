import { Module } from '@nestjs/common'
import { AccountingController } from './controllers/accounting.controller'
import { AccountingService } from './services/accounting.service'

@Module({
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
