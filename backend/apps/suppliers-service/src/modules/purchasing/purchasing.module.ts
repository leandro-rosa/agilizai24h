import { Module } from '@nestjs/common'
import { ProductsClient } from './clients/products.client'
import { SalesClient } from './clients/sales.client'
import { PayablesController } from './controllers/payables.controller'
import { PayablesService } from './services/payables.service'
import { PurchasesController } from './controllers/purchases.controller'
import { SettlementsController } from './controllers/settlements.controller'
import { MailTransport } from './mail/mail-transport'
import { OrderEmailService } from './mail/order-email.service'
import { SmtpTransport } from './mail/smtp-transport'
import { PurchaseImportService } from './services/purchase-import.service'
import { PurchasesService } from './services/purchases.service'
import { SettlementService } from './services/settlement.service'

@Module({
  controllers: [PurchasesController, PayablesController, SettlementsController],
  providers: [PurchasesService, PayablesService, PurchaseImportService, SettlementService, OrderEmailService, { provide: MailTransport, useClass: SmtpTransport }, ProductsClient, SalesClient],
  exports: [PurchasesService],
})
export class PurchasingModule {}
