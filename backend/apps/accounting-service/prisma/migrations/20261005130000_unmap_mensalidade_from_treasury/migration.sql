-- 3.1.03 Mensalidades stays manual-only / billing-service-authoritative —
-- billing-service is the sole source of truth for mensalidade (root
-- CLAUDE.md), and this account already carries real per-store
-- `origin: 'billing'` entries. Mapping it to a treasury category (done in
-- the previous migration) would double-count once billing writes rows for
-- a period this sync has also touched, because pnl()'s network view sums
-- every entry for an account across every store AND the network row
-- together with no distinction by origin.
UPDATE "account" SET auto_source = NULL, treasury_category = NULL WHERE code = '3.1.03';
