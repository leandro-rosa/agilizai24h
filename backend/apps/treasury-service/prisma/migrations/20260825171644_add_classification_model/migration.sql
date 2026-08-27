-- Adds the `kind` classification axis (revenue | expense | movement | pending),
-- independent of the DRE-facing `nature`, plus neutralization linking on
-- BankTransaction, and `kind`/`match_type` on CounterpartyMapping.
--
-- `kind` is added nullable, backfilled, then made required — every row that
-- exists before this migration was, in fact, entered as a fornecedor expense
-- (see add-treasury-classification-model design.md, Migration Plan step 2).

-- AlterTable
ALTER TABLE "bank_transaction" ADD COLUMN     "kind" TEXT,
ADD COLUMN     "neutralized_with_id" INTEGER,
ALTER COLUMN "nature" DROP NOT NULL;

-- Backfill: every existing row was entered as a fornecedor expense.
UPDATE "bank_transaction" SET "kind" = 'expense' WHERE "kind" IS NULL;

ALTER TABLE "bank_transaction" ALTER COLUMN "kind" SET NOT NULL;

-- AlterTable
ALTER TABLE "counterparty_mapping" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'expense',
ADD COLUMN     "match_type" TEXT NOT NULL DEFAULT 'exact',
ALTER COLUMN "nature" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "bank_transaction_kind_period_idx" ON "bank_transaction"("kind", "period");

-- CreateIndex
CREATE INDEX "bank_transaction_neutralized_with_id_idx" ON "bank_transaction"("neutralized_with_id");

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_neutralized_with_id_fkey" FOREIGN KEY ("neutralized_with_id") REFERENCES "bank_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
