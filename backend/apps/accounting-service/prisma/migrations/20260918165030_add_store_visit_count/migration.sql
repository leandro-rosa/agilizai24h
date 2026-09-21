-- CreateTable
CREATE TABLE "store_visit_count" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "visit_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_visit_count_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_visit_count_period_idx" ON "store_visit_count"("period");

-- CreateIndex
CREATE UNIQUE INDEX "store_visit_count_store_id_period_key" ON "store_visit_count"("store_id", "period");
