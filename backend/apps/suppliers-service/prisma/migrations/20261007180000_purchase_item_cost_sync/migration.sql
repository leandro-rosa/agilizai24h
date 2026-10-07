-- Outbox of the invoice cost: a received purchase item is sent to products-service by a retrying loop, never inside the receipt.
-- Additive. Existing items keep cost_sync NULL: nothing is sent retroactively without a decision.
ALTER TABLE "purchase_item"
  ADD COLUMN "cost_sync" TEXT,
  ADD COLUMN "cost_sync_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cost_sync_attempted_at" TIMESTAMP(3),
  ADD COLUMN "cost_synced_at" TIMESTAMP(3),
  ADD COLUMN "cost_sync_error" TEXT,
  ADD COLUMN "cost_version_id" INTEGER,
  ADD COLUMN "cost_previous_cents" INTEGER,
  ADD COLUMN "cost_variation_bps" INTEGER,
  ADD COLUMN "cost_alerts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "purchase_item"
  ADD CONSTRAINT "purchase_item_cost_sync_check" CHECK ("cost_sync" IS NULL OR "cost_sync" IN ('pending', 'synced', 'unchanged', 'skipped_bonus', 'failed'));

CREATE INDEX "purchase_item_cost_sync_idx" ON "purchase_item"("cost_sync");
