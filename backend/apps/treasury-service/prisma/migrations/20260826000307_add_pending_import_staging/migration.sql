-- CreateTable
CREATE TABLE "pending_import" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'staged',
    "object_key" TEXT NOT NULL,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_line_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_transaction" (
    "id" SERIAL NOT NULL,
    "pending_import_id" INTEGER NOT NULL,
    "occurred_on" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty_raw" TEXT NOT NULL,
    "source_ref" TEXT,
    "installment_index" INTEGER,
    "installment_total" INTEGER,
    "suggested_kind" TEXT,
    "suggested_category" TEXT,
    "suggested_nature" TEXT,
    "suggested_supplier_id" INTEGER,
    "proof_object_key" TEXT,
    "likely_duplicate_of_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_rejection" (
    "id" SERIAL NOT NULL,
    "pending_import_id" INTEGER NOT NULL,
    "row_reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_rejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_import_account_id_period_source_idx" ON "pending_import"("account_id", "period", "source");

-- CreateIndex
CREATE INDEX "pending_import_status_idx" ON "pending_import"("status");

-- CreateIndex
CREATE INDEX "pending_transaction_pending_import_id_idx" ON "pending_transaction"("pending_import_id");

-- CreateIndex
CREATE INDEX "pending_rejection_pending_import_id_idx" ON "pending_rejection"("pending_import_id");

-- AddForeignKey
ALTER TABLE "pending_import" ADD CONSTRAINT "pending_import_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_transaction" ADD CONSTRAINT "pending_transaction_pending_import_id_fkey" FOREIGN KEY ("pending_import_id") REFERENCES "pending_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_rejection" ADD CONSTRAINT "pending_rejection_pending_import_id_fkey" FOREIGN KEY ("pending_import_id") REFERENCES "pending_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;
