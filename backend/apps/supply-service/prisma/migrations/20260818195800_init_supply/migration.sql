-- CreateTable
CREATE TABLE "removal_reason" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "counts_as_loss" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "removal_reason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restock_record" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity_restocked" INTEGER NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restock_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "removal_record" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "reason_id" INTEGER NOT NULL,
    "quantity_removed" INTEGER NOT NULL,
    "source_text" TEXT,
    "ingestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "removal_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingested_period" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "restock_count" INTEGER NOT NULL,
    "removal_count" INTEGER NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingested_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "removal_reason_key_key" ON "removal_reason"("key");

-- CreateIndex
CREATE INDEX "restock_record_store_id_period_idx" ON "restock_record"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "restock_record_store_id_period_sku_key" ON "restock_record"("store_id", "period", "sku");

-- CreateIndex
CREATE INDEX "removal_record_store_id_period_idx" ON "removal_record"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "removal_record_store_id_period_sku_reason_id_key" ON "removal_record"("store_id", "period", "sku", "reason_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingested_period_store_id_period_key" ON "ingested_period"("store_id", "period");

-- AddForeignKey
ALTER TABLE "removal_record" ADD CONSTRAINT "removal_record_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "removal_reason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
