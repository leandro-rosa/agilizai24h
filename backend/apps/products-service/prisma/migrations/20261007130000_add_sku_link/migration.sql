-- CreateTable
CREATE TABLE "sku_link" (
    "id" SERIAL NOT NULL,
    "old_sku" TEXT NOT NULL,
    "new_sku" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sku_link_new_sku_idx" ON "sku_link"("new_sku");

-- CreateIndex
CREATE UNIQUE INDEX "sku_link_old_sku_new_sku_key" ON "sku_link"("old_sku", "new_sku");
