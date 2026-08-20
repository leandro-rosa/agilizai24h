-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "bank_account" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "last_digits" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transaction" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "occurred_on" DATE NOT NULL,
    "period" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "counterparty_raw" TEXT NOT NULL,
    "supplier_id" INTEGER,
    "entry_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "nature" TEXT NOT NULL,
    "store_id" INTEGER,
    "installment_index" INTEGER,
    "installment_total" INTEGER,
    "source_ref" TEXT,
    "ingestion_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_mapping" (
    "id" SERIAL NOT NULL,
    "match_text" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "supplier_id" INTEGER,
    "entry_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "nature" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparty_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquirer_fee" (
    "id" SERIAL NOT NULL,
    "acquirer" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquirer_fee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_receipt" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER,
    "period" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "settled_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_name_key" ON "bank_account"("name");

-- CreateIndex
CREATE INDEX "bank_transaction_period_idx" ON "bank_transaction"("period");

-- CreateIndex
CREATE INDEX "bank_transaction_account_id_period_idx" ON "bank_transaction"("account_id", "period");

-- CreateIndex
CREATE INDEX "bank_transaction_supplier_id_idx" ON "bank_transaction"("supplier_id");

-- CreateIndex
CREATE INDEX "bank_transaction_nature_period_idx" ON "bank_transaction"("nature", "period");

-- CreateIndex
CREATE INDEX "bank_transaction_store_id_period_idx" ON "bank_transaction"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_mapping_match_text_key" ON "counterparty_mapping"("match_text");

-- CreateIndex
CREATE UNIQUE INDEX "acquirer_fee_acquirer_payment_method_effective_from_key" ON "acquirer_fee"("acquirer", "payment_method", "effective_from");

-- CreateIndex
CREATE INDEX "settlement_receipt_period_idx" ON "settlement_receipt"("period");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_receipt_store_id_period_payment_method_key" ON "settlement_receipt"("store_id", "period", "payment_method");

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
