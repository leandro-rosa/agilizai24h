import { Module } from '@nestjs/common'
import { TreasuryController } from './controllers/treasury.controller'
import { TreasuryService } from './services/treasury.service'

@Module({
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
