-- CreateEnum
CREATE TYPE "quote_source" AS ENUM ('spreadsheet', 'partner_api');

-- CreateTable
CREATE TABLE "quote" (
    "id" SERIAL NOT NULL,
    "source" "quote_source" NOT NULL DEFAULT 'spreadsheet',
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "original_file_name" TEXT,
    "original_file_size_b" INTEGER,
    "original_file_s3_key" TEXT,
    "selected_sheet" TEXT,
    "header_row" INTEGER,
    "column_mapping_id" INTEGER,
    "normalization_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "partner_name" TEXT,
    "external_id" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "reviewed_rows" INTEGER NOT NULL DEFAULT 0,
    "matched_rows" INTEGER NOT NULL DEFAULT 0,
    "unmatched_rows" INTEGER NOT NULL DEFAULT 0,
    "ambiguous_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_item" (
    "id" SERIAL NOT NULL,
    "quote_id" INTEGER NOT NULL,
    "row_number" INTEGER NOT NULL DEFAULT 0,
    "raw_input" JSONB NOT NULL,
    "normalized_data" JSONB,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "match_score" INTEGER,
    "match_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_status" TEXT NOT NULL DEFAULT 'pending',
    "selected_candidate_id" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'pending',
    "review_decision" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "column_mapping_template" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "mappings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "column_mapping_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_export" (
    "id" SERIAL NOT NULL,
    "quote_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "format" TEXT NOT NULL,
    "selected_fields" JSONB NOT NULL,
    "custom_attribute_fields" JSONB,
    "file_s3_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "quote_export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_activity_event" (
    "id" SERIAL NOT NULL,
    "quote_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actor" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_activity_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_source_idx" ON "quote"("source");

-- CreateIndex
CREATE INDEX "quote_status_idx" ON "quote"("status");

-- CreateIndex
CREATE INDEX "quote_created_at_idx" ON "quote"("created_at");

-- CreateIndex
CREATE INDEX "quote_item_quote_id_idx" ON "quote_item"("quote_id");

-- CreateIndex
CREATE INDEX "quote_item_quote_id_review_status_idx" ON "quote_item"("quote_id", "review_status");

-- CreateIndex
CREATE INDEX "quote_item_quote_id_match_status_idx" ON "quote_item"("quote_id", "match_status");

-- CreateIndex
CREATE INDEX "quote_export_quote_id_idx" ON "quote_export"("quote_id");

-- CreateIndex
CREATE INDEX "quote_activity_event_quote_id_id_idx" ON "quote_activity_event"("quote_id", "id");

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_column_mapping_id_fkey" FOREIGN KEY ("column_mapping_id") REFERENCES "column_mapping_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_item" ADD CONSTRAINT "quote_item_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_export" ADD CONSTRAINT "quote_export_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_activity_event" ADD CONSTRAINT "quote_activity_event_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
