-- CreateTable
CREATE TABLE "product" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_version" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_name_override" (
    "id" SERIAL NOT NULL,
    "source_normalized_name" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_name_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_key" ON "product"("sku");

-- CreateIndex
CREATE INDEX "product_normalized_name_idx" ON "product"("normalized_name");

-- CreateIndex
CREATE INDEX "cost_version_product_id_effective_from_idx" ON "cost_version"("product_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "cost_version_product_id_effective_from_key" ON "cost_version"("product_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "product_name_override_source_normalized_name_key" ON "product_name_override"("source_normalized_name");

-- AddForeignKey
ALTER TABLE "cost_version" ADD CONSTRAINT "cost_version_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_name_override" ADD CONSTRAINT "product_name_override_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
