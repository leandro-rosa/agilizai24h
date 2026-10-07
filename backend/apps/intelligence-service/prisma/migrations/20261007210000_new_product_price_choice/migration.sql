-- Audit of the price choice made for a product registered from an invoice. It records; it never writes a price.
CREATE TABLE "new_product_price_choice" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "choice" TEXT NOT NULL,
  "suggested_price_cents" INTEGER,
  "confidence" TEXT,
  "parameter_version_id" INTEGER,
  "chosen_price_cents" INTEGER,
  "decision_id" TEXT,
  "reason" TEXT,
  "actor" TEXT NOT NULL,
  "cost_cents" INTEGER,
  "cost_origin" TEXT,
  "cost_not_received" BOOLEAN NOT NULL DEFAULT false,
  "data_used" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "new_product_price_choice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "new_product_price_choice_idempotency_key_key" ON "new_product_price_choice"("idempotency_key");
CREATE INDEX "new_product_price_choice_sku_created_at_idx" ON "new_product_price_choice"("sku", "created_at");
-- A price is chosen unless the product was left without one (explicit IS NOT NULL: a NULL expression would pass a CHECK).
ALTER TABLE "new_product_price_choice" ADD CONSTRAINT "new_product_price_choice_check" CHECK (
  "choice" IN ('suggested_accepted', 'changed_by_hand', 'left_without_price')
  AND (("choice" = 'left_without_price' AND "chosen_price_cents" IS NULL) OR ("choice" <> 'left_without_price' AND "chosen_price_cents" IS NOT NULL AND "chosen_price_cents" > 0))
);
