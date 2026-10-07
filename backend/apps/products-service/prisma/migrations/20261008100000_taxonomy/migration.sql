-- Managed categories and subcategories. The starting taxonomy is exactly what already exists: the four category keys the products carry and the
-- subcategory texts they already have. NO product is changed.
ALTER TABLE "product" ADD COLUMN "classification_confirmed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "category" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "category_key_key" ON "category"("key");
-- One name per category, ignoring case and accents.
CREATE UNIQUE INDEX "category_name_folded_key" ON "category"(lower(translate("name", 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')));
ALTER TABLE "category" ADD CONSTRAINT "category_status_check" CHECK ("status" IN ('active', 'inactive'));

CREATE TABLE "subcategory" (
  "id" SERIAL NOT NULL,
  "category_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subcategory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "subcategory_category_id_idx" ON "subcategory"("category_id");
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- One name per category, ignoring case and accents.
CREATE UNIQUE INDEX "subcategory_name_folded_key" ON "subcategory"("category_id", lower(translate("name", 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')));
ALTER TABLE "subcategory" ADD CONSTRAINT "subcategory_status_check" CHECK ("status" IN ('active', 'inactive'));

-- Starting categories: the four keys in use, named as the admin already calls them.
INSERT INTO "category" ("key", "name", "keywords", "updated_at") VALUES
  ('meal', 'Refeição', ARRAY['marmita','marmitex','refeicao','almoco','jantar','prato feito'], CURRENT_TIMESTAMP),
  ('snack', 'Lanche', ARRAY['lanche','salgado','doce','biscoito','bolo','snack'], CURRENT_TIMESTAMP),
  ('beverage', 'Bebida', ARRAY['bebida','suco','agua','refrigerante','cha','cafe','energetico'], CURRENT_TIMESTAMP),
  ('essential', 'Essencial', ARRAY['essencial','higiene','limpeza','mercearia'], CURRENT_TIMESTAMP);

-- Starting subcategories: the distinct texts already on products, under the category they already have (case-insensitive duplicates merged into the
-- most used spelling). Keywords are suggestions for the ones we can recognise; they are editable.
INSERT INTO "subcategory" ("category_id", "name", "keywords", "updated_at")
SELECT c."id", pick."name",
  CASE lower(translate(pick."name", 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
    WHEN 'energeticos' THEN ARRAY['energetico','energy','monster','red bull','redbull','tnt']
    WHEN 'refrigerantes' THEN ARRAY['refrigerante','guarana','coca cola','pepsi','fanta','sprite','soda']
    WHEN 'chas' THEN ARRAY['cha','mate','ice tea','matte']
    WHEN 'salgadinhos' THEN ARRAY['salgadinho','chips','doritos','ruffles','cheetos','fandangos']
    WHEN 'chocolates' THEN ARRAY['chocolate','bombom','barra de chocolate','trufa']
    WHEN 'balas' THEN ARRAY['bala','balas','goma','chiclete','pirulito']
    WHEN 'salgados' THEN ARRAY['salgado','coxinha','pastel','empada']
    WHEN 'panetone' THEN ARRAY['panetone','chocotone']
    ELSE ARRAY[]::TEXT[]
  END,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("category", lower(trim("subcategory"))) "category", trim("subcategory") AS "name"
  FROM (SELECT "category", "subcategory", count(*) OVER (PARTITION BY "category", lower(trim("subcategory")), trim("subcategory")) AS uses FROM "product" WHERE "subcategory" IS NOT NULL AND trim("subcategory") <> '') seen
  ORDER BY "category", lower(trim("subcategory")), uses DESC, trim("subcategory")
) pick
JOIN "category" c ON c."key" = pick."category";
