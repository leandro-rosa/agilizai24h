-- AlterTable: observable count of operations with no client (distribution-center inventory)
ALTER TABLE "ingestion" ADD COLUMN "no_client_operations" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "no_client_lines" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: the visit's own instants
ALTER TABLE "ingestion_operation" ADD COLUMN "started_at" TIMESTAMP(3),
ADD COLUMN "previous_finished_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "staged_visit_line" (
    "id" SERIAL NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "store_id" INTEGER NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "confirmed_count" INTEGER,
    "quantity_to_restock" INTEGER,
    "restocked" INTEGER NOT NULL,
    "removed_total" INTEGER NOT NULL,
    "adjustment" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "capacity" INTEGER,

    CONSTRAINT "staged_visit_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staged_visit_line_ingestion_id_idx" ON "staged_visit_line"("ingestion_id");

-- AddForeignKey
ALTER TABLE "staged_visit_line" ADD CONSTRAINT "staged_visit_line_ingestion_id_fkey" FOREIGN KEY ("ingestion_id") REFERENCES "ingestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
