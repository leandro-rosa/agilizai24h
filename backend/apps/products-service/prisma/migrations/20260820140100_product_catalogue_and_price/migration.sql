-- Campos de catálogo e preço de venda datado, vindos das abas de produto da
-- planilha de relatórios.
--
-- Todas as colunas novas são nullable: os 232 produtos existentes não têm
-- nenhuma delas, e um NOT NULL faria a migration falhar em base com dado real.

ALTER TABLE "product" ADD COLUMN "subcategory" TEXT;
ALTER TABLE "product" ADD COLUMN "ean" TEXT;
ALTER TABLE "product" ADD COLUMN "supplier_id" INTEGER;
ALTER TABLE "product" ADD COLUMN "net_weight" TEXT;
ALTER TABLE "product" ADD COLUMN "ncm" TEXT;
ALTER TABLE "product" ADD COLUMN "cest" TEXT;
ALTER TABLE "product" ADD COLUMN "shelf_life_days" INTEGER;
ALTER TABLE "product" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

-- Dois produtos com o mesmo EAN é erro de cadastro: o PDV resolve a venda por
-- ele, e um EAN duplicado atribuiria a venda ao produto errado.
CREATE UNIQUE INDEX "product_ean_key" ON "product"("ean");

CREATE TABLE "price_version" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_version_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_version_product_id_effective_from_key"
  ON "price_version"("product_id", "effective_from");
CREATE INDEX "price_version_product_id_effective_from_idx"
  ON "price_version"("product_id", "effective_from");

ALTER TABLE "price_version" ADD CONSTRAINT "price_version_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
