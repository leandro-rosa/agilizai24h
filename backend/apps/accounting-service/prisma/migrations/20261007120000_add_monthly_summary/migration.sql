-- CreateTable
CREATE TABLE "monthly_summary" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "base_at" TIMESTAMP(3) NOT NULL,
    "content_hash" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_summary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_summary_period_idx" ON "monthly_summary"("period");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_summary_period_version_key" ON "monthly_summary"("period", "version");
