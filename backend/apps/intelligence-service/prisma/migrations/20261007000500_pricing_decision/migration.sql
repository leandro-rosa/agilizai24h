-- CreateTable
CREATE TABLE "pricing_decision" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "previous_price_cents" INTEGER,
    "new_price_cents" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "actor" TEXT NOT NULL,
    "recommended_price_cents" INTEGER,
    "confidence" TEXT,
    "run_id" TEXT,
    "parameter_version_id" INTEGER,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_decision_idempotency_key_key" ON "pricing_decision"("idempotency_key");

-- CreateIndex
CREATE INDEX "pricing_decision_sku_created_at_idx" ON "pricing_decision"("sku", "created_at");

-- CreateIndex
CREATE INDEX "pricing_decision_status_created_at_idx" ON "pricing_decision"("status", "created_at");
