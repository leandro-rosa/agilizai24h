-- Cost and price versions become append-only with provenance.
--
-- 1) Provenance columns. `source` is added with a default so every EXISTING row is backfilled as `legacy_import`
--    (its origin was never recorded; nothing is invented), and the default is dropped right after so a new row can
--    never be silently labelled "legacy".
ALTER TABLE "cost_version" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy_import';
ALTER TABLE "cost_version" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "cost_version"
  ADD COLUMN "actor" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "source_ref" TEXT,
  ADD COLUMN "supplier_id" INTEGER,
  ADD COLUMN "purchase_id" INTEGER,
  ADD COLUMN "purchase_item_id" INTEGER,
  ADD COLUMN "invoice_number" TEXT,
  ADD COLUMN "purchase_quantity" INTEGER,
  ADD COLUMN "purchase_total_cents" INTEGER,
  ADD COLUMN "pack_quantity" INTEGER,
  ADD COLUMN "units_per_pack" INTEGER;

ALTER TABLE "price_version" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy_import';
ALTER TABLE "price_version" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "price_version"
  ADD COLUMN "actor" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "source_ref" TEXT;

-- 2) Recording the same effective date again now ADDS a version instead of replacing the value. The non-unique
--    index on (product_id, effective_from) already exists and keeps the lookups fast.
DROP INDEX "cost_version_product_id_effective_from_key";
DROP INDEX "price_version_product_id_effective_from_key";

-- 3) The only uniqueness left: an origin that supplies an idempotency key cannot create the same version twice
--    (e.g. the same purchase item synced twice).
CREATE UNIQUE INDEX "cost_version_source_source_ref_key" ON "cost_version"("source", "source_ref") WHERE "source_ref" IS NOT NULL;
CREATE UNIQUE INDEX "price_version_source_source_ref_key" ON "price_version"("source", "source_ref") WHERE "source_ref" IS NOT NULL;

-- 4) Sale unit of the product ("un" by default). The internal code stays the SKU.
ALTER TABLE "product" ADD COLUMN "sale_unit" TEXT NOT NULL DEFAULT 'un';
