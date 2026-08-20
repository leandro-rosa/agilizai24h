import { Module } from '@nestjs/common'
import { AwsModule } from '@app/aws'
import { IngestionController } from '../ingestion/ingestion.controller'
import { OverviewController } from './controllers/overview.controller'
import { FinanceController } from './controllers/finance.controller'
import { InventoryController } from './controllers/inventory.controller'
import { ProductsController } from './controllers/products.controller'
import { SalesController } from './controllers/sales.controller'
import { StoresController } from './controllers/stores.controller'
import { SupplyController } from './controllers/supply.controller'
import { AccountingController } from './controllers/accounting.controller'
import { BillingController } from './controllers/billing.controller'
import { CapexController } from './controllers/capex.controller'
import { SuppliersController } from './controllers/suppliers.controller'
import { TreasuryController } from './controllers/treasury.controller'

@Module({
  imports: [AwsModule],
  controllers: [
    StoresController,
    ProductsController,
    SalesController,
    SupplyController,
    InventoryController,
    FinanceController,
    SuppliersController,
    TreasuryController,
    AccountingController,
    BillingController,
    CapexController,
    OverviewController,
    IngestionController,
  ],
})
export class DomainsModule {}
