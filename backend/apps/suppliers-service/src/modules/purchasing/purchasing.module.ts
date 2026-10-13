import { Module } from '@nestjs/common'
import { AccountingClient } from './clients/accounting.client'
import { ProductsClient } from './clients/products.client'
import { SalesClient } from './clients/sales.client'
import { ConsignmentController } from './controllers/consignment.controller'
import { PayablesController } from './controllers/payables.controller'
import { ConsignmentAgreementService } from './services/consignment-agreement.service'
import { PayablesService } from './services/payables.service'
import { PurchasesController } from './controllers/purchases.controller'
import { SettlementsController } from './controllers/settlements.controller'
import { MailTransport } from './mail/mail-transport'
import { OrderEmailService } from './mail/order-email.service'
import { SmtpTransport } from './mail/smtp-transport'
import { CostSyncService } from './services/cost-sync.service'
import { PurchaseImportService } from './services/purchase-import.service'
import { PurchasesService } from './services/purchases.service'
import { SettlementService } from './services/settlement.service'

@Module({
  controllers: [PurchasesController, PayablesController, SettlementsController, ConsignmentController],
  providers: [PurchasesService, PayablesService, PurchaseImportService, SettlementService, ConsignmentAgreementService, OrderEmailService, { provide: MailTransport, useClass: SmtpTransport }, ProductsClient, SalesClient, AccountingClient, CostSyncService],
  exports: [PurchasesService],
})
export class PurchasingModule {}
