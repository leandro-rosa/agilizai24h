-- AlterTable: the per-reason split of a visit line (additive; null = ingested before the split was kept)
ALTER TABLE "supply_visit_line" ADD COLUMN "removals_by_reason" JSONB;
