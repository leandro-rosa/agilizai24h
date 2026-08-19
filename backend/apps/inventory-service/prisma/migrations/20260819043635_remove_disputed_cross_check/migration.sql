-- Removes the disputed-balance cross-check (design D5, reversed): Qtd. final
-- is a visit-moment reading, not a month-end one, so comparing it to a whole
-- month's derived total produced false disagreements on real data.
ALTER TABLE "stock_snapshot" DROP COLUMN "disputed";
