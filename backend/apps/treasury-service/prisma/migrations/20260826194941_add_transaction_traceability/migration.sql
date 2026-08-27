-- AlterTable
ALTER TABLE "bank_transaction" ADD COLUMN     "mapping_rule_id" INTEGER,
ADD COLUMN     "pending_import_id" INTEGER;

-- AlterTable
ALTER TABLE "pending_transaction" ADD COLUMN     "mapping_rule_id" INTEGER;

-- CreateIndex
CREATE INDEX "bank_transaction_pending_import_id_idx" ON "bank_transaction"("pending_import_id");

-- CreateIndex
CREATE INDEX "bank_transaction_mapping_rule_id_idx" ON "bank_transaction"("mapping_rule_id");

-- CreateIndex
CREATE INDEX "pending_transaction_mapping_rule_id_idx" ON "pending_transaction"("mapping_rule_id");

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_pending_import_id_fkey" FOREIGN KEY ("pending_import_id") REFERENCES "pending_import"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_mapping_rule_id_fkey" FOREIGN KEY ("mapping_rule_id") REFERENCES "counterparty_mapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_transaction" ADD CONSTRAINT "pending_transaction_mapping_rule_id_fkey" FOREIGN KEY ("mapping_rule_id") REFERENCES "counterparty_mapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;
