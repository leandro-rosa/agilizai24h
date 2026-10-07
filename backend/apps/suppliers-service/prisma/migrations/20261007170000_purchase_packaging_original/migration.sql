-- The original of a package purchase and the invoice issue date. Nullable: purchases recorded before this keep NULL, which the
-- screens show as "original not recorded"; nothing is made up for them.
ALTER TABLE "purchase" ADD COLUMN "invoice_issued_on" DATE;

ALTER TABLE "purchase_item"
  ADD COLUMN "pack_quantity" INTEGER,
  ADD COLUMN "pack_unit_price_cents" INTEGER,
  ADD COLUMN "units_per_pack" INTEGER,
  ADD COLUMN "purchase_unit" TEXT;

-- The three package numbers go together and are positive. Written with explicit IS NOT NULL on purpose: a CHECK whose
-- expression is NULL PASSES in SQL, so "3 > 0 AND NULL > 0" would have let a half-recorded original through.
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_packaging_together_check" CHECK (
  ("pack_quantity" IS NULL AND "pack_unit_price_cents" IS NULL AND "units_per_pack" IS NULL)
  OR (
    "pack_quantity" IS NOT NULL AND "pack_unit_price_cents" IS NOT NULL AND "units_per_pack" IS NOT NULL
    AND "pack_quantity" > 0 AND "pack_unit_price_cents" > 0 AND "units_per_pack" > 0
  )
);
