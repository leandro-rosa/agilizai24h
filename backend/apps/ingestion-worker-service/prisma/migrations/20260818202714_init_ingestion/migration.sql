-- CreateTable
CREATE TABLE "ingestion" (
    "id" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "error" TEXT,
    "expected_chunks" INTEGER NOT NULL DEFAULT 0,
    "processed_chunks" INTEGER NOT NULL DEFAULT 0,
    "accepted_rows" INTEGER NOT NULL DEFAULT 0,
    "rejected_rows" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staged_row" (
    "id" SERIAL NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "reason_key" TEXT,
    "quantity" INTEGER,
    "amount_cents" INTEGER,
    "source_text" TEXT,

    CONSTRAINT "staged_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_rejection" (
    "id" SERIAL NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "row_reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_rejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingestion_store_id_period_idx" ON "ingestion"("store_id", "period");

-- CreateIndex
CREATE INDEX "ingestion_status_idx" ON "ingestion"("status");

-- CreateIndex
CREATE INDEX "staged_row_ingestion_id_idx" ON "staged_row"("ingestion_id");

-- CreateIndex
CREATE INDEX "ingestion_rejection_ingestion_id_idx" ON "ingestion_rejection"("ingestion_id");

-- AddForeignKey
ALTER TABLE "staged_row" ADD CONSTRAINT "staged_row_ingestion_id_fkey" FOREIGN KEY ("ingestion_id") REFERENCES "ingestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_rejection" ADD CONSTRAINT "ingestion_rejection_ingestion_id_fkey" FOREIGN KEY ("ingestion_id") REFERENCES "ingestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
