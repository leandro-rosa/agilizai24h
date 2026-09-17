-- CreateIndex
CREATE INDEX "bank_transaction_account_id_occurred_on_idx" ON "bank_transaction"("account_id", "occurred_on");
