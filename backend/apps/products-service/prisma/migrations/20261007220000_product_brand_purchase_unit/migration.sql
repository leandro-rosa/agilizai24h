-- Brand and the unit the supplier sells in. Additive; existing products keep both empty (not guessed).
ALTER TABLE "product" ADD COLUMN "brand" TEXT, ADD COLUMN "purchase_unit" TEXT;

-- A product can now also be created by an Excel import.
ALTER TABLE "product" DROP CONSTRAINT "product_origin_check";
ALTER TABLE "product" ADD CONSTRAINT "product_origin_check" CHECK (
  "origin" IN ('manual', 'invoice', 'excel', 'legacy_import')
  AND ("origin" <> 'invoice' OR ("origin_invoice_number" IS NOT NULL AND "origin_supplier_id" IS NOT NULL AND "origin_on" IS NOT NULL AND "origin_actor" IS NOT NULL))
);
