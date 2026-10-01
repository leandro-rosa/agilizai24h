-- AlterTable
ALTER TABLE "engine_run" ALTER COLUMN "data_through" DROP NOT NULL;

-- CreateTable
CREATE TABLE "engine_run_store" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "store_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "pairs" INTEGER NOT NULL DEFAULT 0,
    "months" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_run_store_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "engine_run_store_run_id_store_id_key" ON "engine_run_store"("run_id", "store_id");

-- AddForeignKey
ALTER TABLE "engine_run_store" ADD CONSTRAINT "engine_run_store_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "engine_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
