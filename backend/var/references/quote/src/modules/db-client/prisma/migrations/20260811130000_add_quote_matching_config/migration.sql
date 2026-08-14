-- AlterTable
ALTER TABLE "quote"
ADD COLUMN "matching_config" JSONB,
ADD COLUMN "matching_config_revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "quote_item"
ADD COLUMN "match_revision" INTEGER NOT NULL DEFAULT 0;
