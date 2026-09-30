-- CreateTable
CREATE TABLE "supply_visit" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3) NOT NULL,
    "previous_ended_at" TIMESTAMP(3),
    "source_reference" TEXT NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_visit_line" (
    "id" SERIAL NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "confirmed_count" INTEGER,
    "quantity_to_restock" INTEGER,
    "restocked" INTEGER NOT NULL,
    "removed_total" INTEGER NOT NULL,
    "adjustment" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "capacity" INTEGER,

    CONSTRAINT "supply_visit_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supply_visit_store_id_ended_at_idx" ON "supply_visit"("store_id", "ended_at");

-- CreateIndex
CREATE INDEX "supply_visit_store_id_period_idx" ON "supply_visit"("store_id", "period");

-- CreateIndex
CREATE INDEX "supply_visit_line_visit_id_sku_idx" ON "supply_visit_line"("visit_id", "sku");

-- AddForeignKey
ALTER TABLE "supply_visit_line" ADD CONSTRAINT "supply_visit_line_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "supply_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
