-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "store_investment" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "total_invested_cents" INTEGER NOT NULL DEFAULT 0,
    "monthly_revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "monthly_profit_cents" INTEGER NOT NULL DEFAULT 0,
    "payback_months" DECIMAL(8,2),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_item" (
    "id" SERIAL NOT NULL,
    "store_investment_id" INTEGER,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplier_id" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "cash_amount_cents" INTEGER NOT NULL,
    "financed_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "installment_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "purchased_on" DATE NOT NULL,
    "funding_source" TEXT NOT NULL,
    "investment_kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "committed_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_contribution" (
    "id" SERIAL NOT NULL,
    "investor_id" INTEGER NOT NULL,
    "contributed_on" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investor_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_investment_store_id_key" ON "store_investment"("store_id");

-- CreateIndex
CREATE INDEX "investment_item_category_idx" ON "investment_item"("category");

-- CreateIndex
CREATE INDEX "investment_item_purchased_on_idx" ON "investment_item"("purchased_on");

-- CreateIndex
CREATE INDEX "investment_item_store_investment_id_idx" ON "investment_item"("store_investment_id");

-- CreateIndex
CREATE UNIQUE INDEX "investor_name_key" ON "investor"("name");

-- CreateIndex
CREATE INDEX "investor_contribution_investor_id_contributed_on_idx" ON "investor_contribution"("investor_id", "contributed_on");

-- AddForeignKey
ALTER TABLE "investment_item" ADD CONSTRAINT "investment_item_store_investment_id_fkey" FOREIGN KEY ("store_investment_id") REFERENCES "store_investment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_contribution" ADD CONSTRAINT "investor_contribution_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
