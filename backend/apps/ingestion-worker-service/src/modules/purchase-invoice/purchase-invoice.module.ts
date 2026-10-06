import { Module } from '@nestjs/common'
import { PurchaseInvoiceController } from './purchase-invoice.controller'

@Module({ controllers: [PurchaseInvoiceController] })
export class PurchaseInvoiceModule {}
