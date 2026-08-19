-- AlterTable
ALTER TABLE "reconciliation" ADD COLUMN     "disputed_stock" TEXT[],
ADD COLUMN     "unclassified_stock_adjustment_value_cents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reconciliation_adjustment" (
    "id" SERIAL NOT NULL,
    "reconciliation_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value_cents" INTEGER NOT NULL,

    CONSTRAINT "reconciliation_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_adjustment_reconciliation_id_idx" ON "reconciliation_adjustment"("reconciliation_id");

-- AddForeignKey
ALTER TABLE "reconciliation_adjustment" ADD CONSTRAINT "reconciliation_adjustment_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "reconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
