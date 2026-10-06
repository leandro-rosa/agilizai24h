import { Module } from '@nestjs/common'
import { ProductsClient } from './clients/products.client'
import { SalesClient } from './clients/sales.client'
import { PurchasesController } from './controllers/purchases.controller'
import { SettlementsController } from './controllers/settlements.controller'
import { PurchaseImportService } from './services/purchase-import.service'
import { PurchasesService } from './services/purchases.service'
import { SettlementService } from './services/settlement.service'

@Module({
  controllers: [PurchasesController, SettlementsController],
  providers: [PurchasesService, PurchaseImportService, SettlementService, ProductsClient, SalesClient],
  exports: [PurchasesService],
})
export class PurchasingModule {}
