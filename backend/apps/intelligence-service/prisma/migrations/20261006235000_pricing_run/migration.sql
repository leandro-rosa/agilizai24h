-- CreateTable
CREATE TABLE "pricing_run" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "store_id" INTEGER,
    "status" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "parameter_version_id" INTEGER NOT NULL,
    "error" TEXT,
    "report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "pricing_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pricing_run_period_store_id_status_idx" ON "pricing_run"("period", "store_id", "status");
