-- AlterTable
ALTER TABLE "settlement" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'regular',
ADD COLUMN "period_start" DATE,
ADD COLUMN "period_end" DATE;

-- Acertos regulares existentes cobrem a semana: [segunda, segunda seguinte)
UPDATE "settlement" SET "period_start" = "week_start", "period_end" = "week_start" + 7 WHERE "period_start" IS NULL;

ALTER TABLE "settlement" ALTER COLUMN "period_start" SET NOT NULL, ALTER COLUMN "period_end" SET NOT NULL;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_period_order" CHECK ("period_end" > "period_start");
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_kind_known" CHECK ("kind" IN ('regular', 'legacy'));

-- CreateIndex
CREATE INDEX "settlement_supplier_id_period_end_idx" ON "settlement"("supplier_id", "period_end");

-- CreateTable
CREATE TABLE "consignment_agreement" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "period_days" INTEGER NOT NULL,
    "first_closing_on" DATE,
    "cost_basis" TEXT NOT NULL DEFAULT 'sale_date',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consignment_agreement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consignment_agreement_period_days_positive" CHECK ("period_days" >= 1),
    CONSTRAINT "consignment_agreement_cost_basis_known" CHECK ("cost_basis" = 'sale_date')
);

-- CreateTable
CREATE TABLE "consignment_cost" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignment_cost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consignment_cost_not_negative" CHECK ("unit_cost_cents" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "consignment_agreement_supplier_id_key" ON "consignment_agreement"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "consignment_cost_supplier_id_sku_valid_from_key" ON "consignment_cost"("supplier_id", "sku", "valid_from");

-- CreateIndex
CREATE INDEX "consignment_cost_supplier_id_sku_idx" ON "consignment_cost"("supplier_id", "sku");

-- AddForeignKey
ALTER TABLE "consignment_agreement" ADD CONSTRAINT "consignment_agreement_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_cost" ADD CONSTRAINT "consignment_cost_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
