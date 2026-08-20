import { Module } from '@nestjs/common'
import { CentralStockController } from './controllers/central-stock.controller'
import { CentralStockService } from './services/central-stock.service'

@Module({
  controllers: [CentralStockController],
  providers: [CentralStockService],
  exports: [CentralStockService],
})
export class CentralStockModule {}
