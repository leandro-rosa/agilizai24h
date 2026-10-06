-- 4.2.08 Alimentação exists in this environment's database but was never
-- added to the original chart-of-accounts seed migration — without this,
-- a freshly migrated database is missing the account entirely, and the
-- auto_source mapping migration that follows this one silently no-ops for
-- it. Child of Deslocamento (4.2.03), same as Gasolina/Pedágio.
-- sort_order 100 is deliberately out of the original 1-26 range: it only
-- needs to sort AFTER its siblings (Gasolina=17, Pedágio=18) within
-- 4.2.03's own children list, which it does regardless of the exact
-- value — it never competes with unrelated root-level accounts since it
-- has a parent.
INSERT INTO "account" ("code", "label", "statement", "section", "sign", "per_store", "sort_order", "parent_id", "updated_at")
SELECT '4.2.08', 'Alimentação', 'pnl', 'variable_expenses', -1, false, 100, (SELECT id FROM "account" WHERE code = '4.2.03'), CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "account" WHERE code = '4.2.08');
