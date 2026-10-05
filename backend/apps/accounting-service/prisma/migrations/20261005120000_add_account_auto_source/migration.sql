-- Marks which DRE accounts have an automatic data source, and from where.
-- Structure of the business (which account maps to which source), not
-- company data — same reasoning as the chart-of-accounts seed migration.
-- Accounts not listed here keep auto_source NULL and stay manual-only.
-- See docs/superpowers/specs/2026-10-05-dre-auto-fill-design.md for why
-- each one was or was not mapped.

ALTER TABLE "account" ADD COLUMN "auto_source" TEXT;
ALTER TABLE "account" ADD COLUMN "treasury_category" TEXT;

UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Receita - Mensalidade' WHERE code = '3.1.03';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Impostos sobre a venda' WHERE code = '3.2.01';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Coffee break' WHERE code = '4.1.02';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Frutas' WHERE code = '4.1.03';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Combustível' WHERE code = '4.2.04';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Pedágio' WHERE code = '4.2.05';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Alimentação' WHERE code = '4.2.08';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Sistema Touchpay' WHERE code = '4.3.01';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Contador' WHERE code = '4.3.02';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Pró-labore' WHERE code = '4.3.03';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Luz' WHERE code = '4.3.04';
UPDATE "account" SET auto_source = 'treasury_category', treasury_category = 'Juros - Limite Garantido' WHERE code = '4.4.01';

UPDATE "account" SET auto_source = 'sales_revenue' WHERE code = '3.1.01';
UPDATE "account" SET auto_source = 'finance_cogs' WHERE code = '4.1.01';
UPDATE "account" SET auto_source = 'finance_loss' WHERE code = '4.2.02';
