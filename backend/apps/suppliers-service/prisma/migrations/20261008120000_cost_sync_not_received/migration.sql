-- A line of a received purchase that received no unit is not a purchase and creates no cost: it gets its own outbox state.
ALTER TABLE "purchase_item" DROP CONSTRAINT "purchase_item_cost_sync_check";
ALTER TABLE "purchase_item"
  ADD CONSTRAINT "purchase_item_cost_sync_check" CHECK ("cost_sync" IS NULL OR "cost_sync" IN ('pending', 'synced', 'unchanged', 'skipped_bonus', 'skipped_not_received', 'failed'));
