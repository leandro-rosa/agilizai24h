-- Invoice lines whose product is not registered yet stay on the purchase instead of being dropped.
CREATE TABLE "purchase_pending_line" (
  "id" SERIAL NOT NULL,
  "purchase_id" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "ean" TEXT,
  "supplier_code" TEXT,
  "quantity" INTEGER NOT NULL,
  "unit_cost_cents" INTEGER NOT NULL,
  "condition" TEXT NOT NULL,
  "pack_quantity" INTEGER,
  "pack_unit_price_cents" INTEGER,
  "units_per_pack" INTEGER,
  "purchase_unit" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "sku" TEXT,
  "item_id" INTEGER,
  "resolved_at" TIMESTAMP(3),
  "resolved_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_pending_line_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_pending_line" ADD CONSTRAINT "purchase_pending_line_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_pending_line" ADD CONSTRAINT "purchase_pending_line_status_check" CHECK ("status" IN ('pending', 'resolved'));
ALTER TABLE "purchase_pending_line" ADD CONSTRAINT "purchase_pending_line_condition_check" CHECK ("condition" IN ('paid', 'bonus', 'on_sale'));
-- A resolved line says which product it became (explicit IS NOT NULL: a NULL expression would pass a CHECK).
ALTER TABLE "purchase_pending_line" ADD CONSTRAINT "purchase_pending_line_resolved_check" CHECK ("status" <> 'resolved' OR ("sku" IS NOT NULL AND "resolved_at" IS NOT NULL));
CREATE INDEX "purchase_pending_line_purchase_id_idx" ON "purchase_pending_line"("purchase_id");
CREATE INDEX "purchase_pending_line_status_idx" ON "purchase_pending_line"("status");
