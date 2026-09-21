-- CreateTable
CREATE TABLE "staged_sales_transaction" (
    "id" SERIAL NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "store_id" INTEGER NOT NULL,
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

    CONSTRAINT "staged_sales_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staged_sales_transaction_ingestion_id_idx" ON "staged_sales_transaction"("ingestion_id");

-- AddForeignKey
ALTER TABLE "staged_sales_transaction" ADD CONSTRAINT "staged_sales_transaction_ingestion_id_fkey" FOREIGN KEY ("ingestion_id") REFERENCES "ingestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
