-- CreateTable
CREATE TABLE "reconciliation" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "restocked_value_cents" INTEGER NOT NULL,
    "cogs_cents" INTEGER NOT NULL,
    "remaining_value_cents" INTEGER NOT NULL,
    "loss_value_cents" INTEGER NOT NULL,
    "loss_quantity" INTEGER NOT NULL,
    "valuation_date" TEXT NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_loss" (
    "id" SERIAL NOT NULL,
    "reconciliation_id" INTEGER NOT NULL,
    "reason" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "value_cents" INTEGER NOT NULL,

    CONSTRAINT "reconciliation_loss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unvalued_sku" (
    "id" SERIAL NOT NULL,
    "reconciliation_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "restocked" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "loss_quantity" INTEGER NOT NULL,

    CONSTRAINT "unvalued_sku_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_period_idx" ON "reconciliation"("period");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_store_id_period_key" ON "reconciliation"("store_id", "period");

-- CreateIndex
CREATE INDEX "reconciliation_loss_reconciliation_id_idx" ON "reconciliation_loss"("reconciliation_id");

-- CreateIndex
CREATE INDEX "unvalued_sku_reconciliation_id_idx" ON "unvalued_sku"("reconciliation_id");

-- AddForeignKey
ALTER TABLE "reconciliation_loss" ADD CONSTRAINT "reconciliation_loss_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "reconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unvalued_sku" ADD CONSTRAINT "unvalued_sku_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "reconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
