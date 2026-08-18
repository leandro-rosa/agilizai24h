-- CreateTable
CREATE TABLE "sales_record" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity_sold" INTEGER NOT NULL,
    "revenue_cents" INTEGER NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingested_period" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingested_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_record_store_id_period_idx" ON "sales_record"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "sales_record_store_id_period_sku_key" ON "sales_record"("store_id", "period", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ingested_period_store_id_period_key" ON "ingested_period"("store_id", "period");
