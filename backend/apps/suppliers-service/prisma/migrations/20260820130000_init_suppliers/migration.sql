-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "supplier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "category" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_alias" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_alias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tax_id_key" ON "supplier"("tax_id");

-- CreateIndex
CREATE INDEX "supplier_status_idx" ON "supplier"("status");

-- CreateIndex
CREATE INDEX "supplier_category_idx" ON "supplier"("category");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_alias_normalized_alias_key" ON "supplier_alias"("normalized_alias");

-- CreateIndex
CREATE INDEX "supplier_alias_supplier_id_idx" ON "supplier_alias"("supplier_id");

-- AddForeignKey
ALTER TABLE "supplier_alias" ADD CONSTRAINT "supplier_alias_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
