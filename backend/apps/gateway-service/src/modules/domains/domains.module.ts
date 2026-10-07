import { Module } from '@nestjs/common'
import { AwsModule } from '@app/aws'
import { DriveFilesController } from '../ingestion/drive-files.controller'
import { IngestionController } from '../ingestion/ingestion.controller'
import { AnalysisController } from './controllers/analysis.controller'
import { PricingController } from './controllers/pricing.controller'
import { PricingApplyService } from './pricing-apply.service'
import { OverviewController } from './controllers/overview.controller'
import { FinanceController } from './controllers/finance.controller'
import { InventoryController } from './controllers/inventory.controller'
import { CatalogueController, CatalogueImportController, CatalogueSyncController, ProductsController, SkuLinksController } from './controllers/products.controller'
import { SalesController } from './controllers/sales.controller'
import { StoresController } from './controllers/stores.controller'
import { SupplyController } from './controllers/supply.controller'
import { AccountingController } from './controllers/accounting.controller'
import { BillingController } from './controllers/billing.controller'
import { CapexController } from './controllers/capex.controller'
import { PayablesController, PurchasesController, SettlementsController } from './controllers/purchases.controller'
import { SuppliersController } from './controllers/suppliers.controller'
import { TreasuryController } from './controllers/treasury.controller'
import { TreasuryDriveFilesController } from './controllers/treasury-drive-files.controller'
import { TreasuryImportsController } from './controllers/treasury-imports.controller'

@Module({
  imports: [AwsModule],
  providers: [PricingApplyService],
  controllers: [
    StoresController,
    ProductsController,
    SkuLinksController,
    CatalogueSyncController,
    CatalogueImportController,
    CatalogueController,
    SalesController,
    SupplyController,
    InventoryController,
    FinanceController,
    SuppliersController,
    PurchasesController,
    SettlementsController, PayablesController,
    TreasuryController,
    TreasuryImportsController,
    TreasuryDriveFilesController,
    AccountingController,
    BillingController,
    CapexController,
    OverviewController,
    AnalysisController,
    PricingController,
    IngestionController,
    DriveFilesController,
  ],
})
export class DomainsModule {}
