-- CreateTable
CREATE TABLE "parameter_version" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "values" JSONB NOT NULL,

    CONSTRAINT "parameter_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baseline_quantity" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baseline_quantity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_schedule" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "weekdays" INTEGER[],
    "note" TEXT,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_store_flag" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "prefer_closed_pack" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_store_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_run" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "parameter_version_id" INTEGER NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "range_from" TEXT NOT NULL,
    "range_to" TEXT NOT NULL,
    "data_through" TEXT NOT NULL,
    "stores_total" INTEGER NOT NULL DEFAULT 0,
    "stores_done" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "engine_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "store_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "mix" TEXT NOT NULL,
    "quantity_action" TEXT NOT NULL,
    "tolerance_status" TEXT NOT NULL,
    "coverage_category" TEXT NOT NULL,
    "releases_balance_use" BOOLEAN NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_run" (
    "id" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "parameter_version_id" INTEGER NOT NULL,
    "origins" JSONB NOT NULL,
    "data_through" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_result" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "origin" TIMESTAMP(3) NOT NULL,
    "store_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "action" TEXT,
    "coherence" TEXT,
    "coverage_category" TEXT NOT NULL,
    "outcome" JSONB NOT NULL,

    CONSTRAINT "backtest_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "baseline_quantity_sku_effective_from_id_idx" ON "baseline_quantity"("sku", "effective_from", "id");

-- CreateIndex
CREATE INDEX "store_schedule_store_id_id_idx" ON "store_schedule"("store_id", "id");

-- CreateIndex
CREATE INDEX "product_store_flag_store_id_sku_id_idx" ON "product_store_flag"("store_id", "sku", "id");

-- CreateIndex
CREATE INDEX "engine_run_created_at_idx" ON "engine_run"("created_at");

-- CreateIndex
CREATE INDEX "recommendation_run_id_store_id_idx" ON "recommendation"("run_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_run_id_store_id_sku_key" ON "recommendation"("run_id", "store_id", "sku");

-- CreateIndex
CREATE INDEX "backtest_result_run_id_origin_idx" ON "backtest_result"("run_id", "origin");

-- AddForeignKey
ALTER TABLE "engine_run" ADD CONSTRAINT "engine_run_parameter_version_id_fkey" FOREIGN KEY ("parameter_version_id") REFERENCES "parameter_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "engine_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_result" ADD CONSTRAINT "backtest_result_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "backtest_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
