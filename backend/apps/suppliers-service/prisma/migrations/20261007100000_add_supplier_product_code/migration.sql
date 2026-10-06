-- CreateTable
CREATE TABLE "supplier_product_code" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_product_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_product_code_supplier_id_code_key" ON "supplier_product_code"("supplier_id", "code");

-- AddForeignKey
ALTER TABLE "supplier_product_code" ADD CONSTRAINT "supplier_product_code_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
