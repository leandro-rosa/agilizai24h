-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "client" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_site" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "tax_id" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "employees" INTEGER,
    "employees_and_clients" INTEGER,
    "service_providers" INTEGER,
    "visitors" INTEGER,
    "weighted_daily_traffic" INTEGER,
    "store_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "monthly_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "revenue_share_bps" INTEGER NOT NULL DEFAULT 0,
    "convenience_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "payment_term_days" INTEGER NOT NULL DEFAULT 30,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "document_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_store" (
    "contract_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,

    CONSTRAINT "contract_store_pkey" PRIMARY KEY ("contract_id","store_id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "contract_id" INTEGER,
    "number" TEXT NOT NULL,
    "purchase_order" TEXT,
    "service_sheet" TEXT,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "issued_on" DATE NOT NULL,
    "payment_term_days" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "paid_on" DATE,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_share" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "base_revenue_cents" INTEGER NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_tax_id_key" ON "client"("tax_id");

-- CreateIndex
CREATE INDEX "client_status_idx" ON "client"("status");

-- CreateIndex
CREATE INDEX "client_site_store_id_idx" ON "client_site"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_site_client_id_code_key" ON "client_site"("client_id", "code");

-- CreateIndex
CREATE INDEX "contract_client_id_status_idx" ON "contract"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_client_id_reference_key" ON "contract"("client_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE INDEX "invoice_client_id_period_idx" ON "invoice"("client_id", "period");

-- CreateIndex
CREATE INDEX "invoice_status_due_on_idx" ON "invoice"("status", "due_on");

-- CreateIndex
CREATE INDEX "revenue_share_period_idx" ON "revenue_share"("period");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_share_store_id_period_key" ON "revenue_share"("store_id", "period");

-- AddForeignKey
ALTER TABLE "client_site" ADD CONSTRAINT "client_site_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_store" ADD CONSTRAINT "contract_store_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
