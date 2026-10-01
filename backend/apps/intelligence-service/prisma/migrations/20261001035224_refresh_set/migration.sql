-- CreateTable
CREATE TABLE "refresh_set" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target_month" TEXT NOT NULL,
    "data_through" TEXT,
    "range_from" TEXT NOT NULL,
    "range_to" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "engine_version" TEXT NOT NULL,
    "parameter_version_id" INTEGER NOT NULL,
    "engine_run_id" TEXT,
    "backtest_id" TEXT,
    "trigger" TEXT NOT NULL,
    "error" TEXT,
    "polls" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_at" TIMESTAMP(3),

    CONSTRAINT "refresh_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_pointer" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "refresh_set_id" TEXT NOT NULL,
    "moved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_pointer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refresh_set_target_month_status_idx" ON "refresh_set"("target_month", "status");

-- CreateIndex
CREATE INDEX "refresh_set_data_through_created_at_idx" ON "refresh_set"("data_through", "created_at");
