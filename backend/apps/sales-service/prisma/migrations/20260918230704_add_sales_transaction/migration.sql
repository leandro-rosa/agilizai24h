-- CreateTable
CREATE TABLE "sales_transaction" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount_paid_cents" INTEGER NOT NULL,
    "original_amount_cents" INTEGER,
    "discount_cents" INTEGER,
    "result" TEXT NOT NULL,
    "method" TEXT,
    "acquirer" TEXT,
    "card_brand" TEXT,
    "card_last_digits" TEXT,
    "internal_code" TEXT,
    "acquirer_code" TEXT,
    "pos_id" TEXT,
    "machine_model" TEXT,
    "buyer_number" TEXT,
    "ingestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_transaction_store_id_period_idx" ON "sales_transaction"("store_id", "period");

-- CreateIndex
CREATE INDEX "sales_transaction_store_id_period_occurred_at_idx" ON "sales_transaction"("store_id", "period", "occurred_at");
