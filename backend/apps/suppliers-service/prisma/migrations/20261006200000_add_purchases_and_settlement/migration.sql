-- CreateTable
CREATE TABLE "purchase" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "ordered_on" DATE NOT NULL,
    "origin" TEXT NOT NULL,
    "invoice_number" TEXT,
    "invoice_key" TEXT,
    "invoice_object_key" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_item" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "paid_on" DATE,
    "payment_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "week_start" DATE NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'proposal',
    "owed_cents" INTEGER NOT NULL,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "paid_on" DATE,
    "payment_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_supplier_id_ordered_on_idx" ON "purchase"("supplier_id", "ordered_on");

-- CreateIndex
CREATE INDEX "purchase_ordered_on_idx" ON "purchase"("ordered_on");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_supplier_id_invoice_number_key" ON "purchase"("supplier_id", "invoice_number");

-- CreateIndex
CREATE INDEX "purchase_item_purchase_id_idx" ON "purchase_item"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_item_sku_idx" ON "purchase_item"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_supplier_id_week_start_key" ON "settlement"("supplier_id", "week_start");

-- CreateIndex
CREATE INDEX "settlement_state_idx" ON "settlement"("state");

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
