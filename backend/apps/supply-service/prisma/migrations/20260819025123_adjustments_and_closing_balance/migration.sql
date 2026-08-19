-- CreateTable
CREATE TABLE "adjustment_record" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adjustment_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recorded_closing_balance" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recorded_closing_balance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adjustment_record_store_id_period_idx" ON "adjustment_record"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_record_store_id_period_sku_key" ON "adjustment_record"("store_id", "period", "sku");

-- CreateIndex
CREATE INDEX "recorded_closing_balance_store_id_period_idx" ON "recorded_closing_balance"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "recorded_closing_balance_store_id_period_sku_key" ON "recorded_closing_balance"("store_id", "period", "sku");
