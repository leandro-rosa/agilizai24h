-- AlterTable: the per-reason split of a visit line (additive; null = staged before the split was carried)
ALTER TABLE "staged_visit_line" ADD COLUMN "removals_by_reason" JSONB;
