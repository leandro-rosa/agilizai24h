-- Several EANs per product. The EAN identifies a package; the SKU identifies the product.

CREATE TABLE "product_ean" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "ean" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" DATE,
    "valid_to" DATE,
    "source" TEXT NOT NULL,
    "actor" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_ean_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_ean_product_id_ean_key" ON "product_ean"("product_id", "ean");
CREATE INDEX "product_ean_ean_idx" ON "product_ean"("ean");
ALTER TABLE "product_ean" ADD CONSTRAINT "product_ean_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An EAN is active on ONE product only (and once on it), and a product has at most one principal EAN, which is active.
CREATE UNIQUE INDEX "product_ean_active_ean_key" ON "product_ean"("ean") WHERE "status" = 'active';
CREATE UNIQUE INDEX "product_ean_one_primary_key" ON "product_ean"("product_id") WHERE "is_primary";
ALTER TABLE "product_ean" ADD CONSTRAINT "product_ean_status_check" CHECK ("status" IN ('active', 'inactive'));
ALTER TABLE "product_ean" ADD CONSTRAINT "product_ean_primary_is_active_check" CHECK (NOT "is_primary" OR "status" = 'active');
ALTER TABLE "product_ean" ADD CONSTRAINT "product_ean_validity_order_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from");

-- Backfill: the single EAN each product already had becomes its active, principal EAN. The start of validity was never
-- recorded, so it stays empty rather than being made up.
INSERT INTO "product_ean" ("product_id", "ean", "status", "is_primary", "source", "updated_at")
SELECT "id", "ean", 'active', true, 'legacy_import', CURRENT_TIMESTAMP FROM "product" WHERE "ean" IS NOT NULL;

-- The old single-EAN column (and its unique index) goes away: the links are the only source of truth.
ALTER TABLE "product" DROP COLUMN "ean";
