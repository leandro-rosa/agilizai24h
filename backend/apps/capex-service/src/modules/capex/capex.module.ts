import { Module } from '@nestjs/common'
import { CapexController } from './controllers/capex.controller'
import { CapexService } from './services/capex.service'

@Module({
  controllers: [CapexController],
  providers: [CapexService],
  exports: [CapexService],
})
export class CapexModule {}
