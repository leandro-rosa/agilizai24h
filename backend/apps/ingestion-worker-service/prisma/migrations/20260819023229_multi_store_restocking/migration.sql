/*
  Warnings:

  - Added the required column `store_id` to the `staged_row` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ingestion" ALTER COLUMN "store_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "staged_row" ADD COLUMN     "movement_kind" TEXT,
ADD COLUMN     "recorded_closing_balance" INTEGER,
ADD COLUMN     "sheet_name" TEXT,
ADD COLUMN     "store_id" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "ingestion_operation" (
    "id" SERIAL NOT NULL,
    "ingestion_id" TEXT NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "client_raw" TEXT NOT NULL,
    "store_id" INTEGER,
    "operation_kind" TEXT NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_operation_ingestion_id_sheet_name_key" ON "ingestion_operation"("ingestion_id", "sheet_name");

-- CreateIndex
CREATE INDEX "staged_row_ingestion_id_store_id_idx" ON "staged_row"("ingestion_id", "store_id");

-- AddForeignKey
ALTER TABLE "ingestion_operation" ADD CONSTRAINT "ingestion_operation_ingestion_id_fkey" FOREIGN KEY ("ingestion_id") REFERENCES "ingestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
