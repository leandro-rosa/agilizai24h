-- The automatic SKU: one persistent counter, never rewound, so a deleted product's SKU is never handed out again.
-- Seeded at the highest six-digit numeric SKU in use, but never below 100112 (the last code the owner registered by hand).
CREATE TABLE "sku_sequence" (
  "id" INTEGER NOT NULL,
  "last_value" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sku_sequence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sku_sequence_single_row" CHECK ("id" = 1),
  CONSTRAINT "sku_sequence_range" CHECK ("last_value" BETWEEN 0 AND 999999)
);

INSERT INTO "sku_sequence" ("id", "last_value")
SELECT 1, GREATEST(100112, COALESCE((SELECT MAX("sku"::integer) FROM "product" WHERE "sku" ~ '^[0-9]{6}$'), 0));
