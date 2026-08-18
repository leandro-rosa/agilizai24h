-- CreateTable
CREATE TABLE "stock_snapshot" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "restocked" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL,
    "removed" INTEGER NOT NULL,
    "closing_stock" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minimum_level" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "minimum" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minimum_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_store" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "last_computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latest_period" TEXT,

    CONSTRAINT "derived_store_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_snapshot_store_id_period_idx" ON "stock_snapshot"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "stock_snapshot_store_id_sku_period_key" ON "stock_snapshot"("store_id", "sku", "period");

-- CreateIndex
CREATE UNIQUE INDEX "minimum_level_store_id_sku_key" ON "minimum_level"("store_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "derived_store_store_id_key" ON "derived_store"("store_id");
