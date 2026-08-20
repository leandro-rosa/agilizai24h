-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "account" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "sign" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "sort_order" INTEGER NOT NULL,
    "per_store" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "store_id" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "source_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnl_snapshot" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "store_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "store_count" INTEGER NOT NULL DEFAULT 0,
    "gross_revenue_cents" INTEGER NOT NULL,
    "deductions_cents" INTEGER NOT NULL,
    "net_revenue_cents" INTEGER NOT NULL,
    "cogs_cents" INTEGER NOT NULL,
    "gross_profit_cents" INTEGER NOT NULL,
    "variable_expenses_cents" INTEGER NOT NULL,
    "contribution_margin_cents" INTEGER NOT NULL,
    "fixed_expenses_cents" INTEGER NOT NULL,
    "ebitda_cents" INTEGER NOT NULL,
    "financial_expenses_cents" INTEGER NOT NULL,
    "operating_profit_cents" INTEGER NOT NULL,
    "break_even_cents" INTEGER NOT NULL,
    "safety_margin_bps" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pnl_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flow_snapshot" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "opening_balance_cents" INTEGER NOT NULL,
    "receipts_cents" INTEGER NOT NULL,
    "opex_cents" INTEGER NOT NULL,
    "loan_payments_cents" INTEGER NOT NULL,
    "capex_cents" INTEGER NOT NULL,
    "closing_balance_cents" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_flow_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_code_key" ON "account"("code");

-- CreateIndex
CREATE INDEX "account_statement_sort_order_idx" ON "account"("statement", "sort_order");

-- CreateIndex
CREATE INDEX "account_parent_id_idx" ON "account"("parent_id");

-- CreateIndex
CREATE INDEX "ledger_entry_period_idx" ON "ledger_entry"("period");

-- CreateIndex
CREATE INDEX "ledger_entry_store_id_period_idx" ON "ledger_entry"("store_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_account_id_period_store_id_key" ON "ledger_entry"("account_id", "period", "store_id");

-- CreateIndex
CREATE INDEX "pnl_snapshot_period_idx" ON "pnl_snapshot"("period");

-- CreateIndex
CREATE UNIQUE INDEX "pnl_snapshot_period_store_id_key" ON "pnl_snapshot"("period", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_flow_snapshot_period_key" ON "cash_flow_snapshot"("period");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índices únicos PARCIAIS para a linha consolidada da rede.
--
-- Em Postgres, NULL <> NULL, então `UNIQUE (account_id, period, store_id)`
-- não impede duas linhas com store_id NULL para a mesma conta e mês — que é
-- exatamente a linha do consolidado. Prisma não expressa índice parcial no
-- schema, então ele é criado aqui.
CREATE UNIQUE INDEX "ledger_entry_network_key"
  ON "ledger_entry" ("account_id", "period") WHERE "store_id" IS NULL;

CREATE UNIQUE INDEX "pnl_snapshot_network_key"
  ON "pnl_snapshot" ("period") WHERE "store_id" IS NULL;
