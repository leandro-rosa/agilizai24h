-- How a product was registered. Existing products came from the initial load: their origin is not recorded, not guessed.
ALTER TABLE "product"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'legacy_import',
  ADD COLUMN "origin_invoice_number" TEXT,
  ADD COLUMN "origin_supplier_id" INTEGER,
  ADD COLUMN "origin_purchase_id" INTEGER,
  ADD COLUMN "origin_on" DATE,
  ADD COLUMN "origin_actor" TEXT;

ALTER TABLE "product" ALTER COLUMN "origin" SET DEFAULT 'manual';

-- An invoice origin is only valid with its evidence (explicit IS NOT NULL: a CHECK that evaluates to NULL passes).
ALTER TABLE "product" ADD CONSTRAINT "product_origin_check" CHECK (
  "origin" IN ('manual', 'invoice', 'legacy_import')
  AND ("origin" <> 'invoice' OR ("origin_invoice_number" IS NOT NULL AND "origin_supplier_id" IS NOT NULL AND "origin_on" IS NOT NULL AND "origin_actor" IS NOT NULL))
);
