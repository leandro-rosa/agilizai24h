-- CreateTable
CREATE TABLE "drive_file" (
    "id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
    "suggested_file_type" TEXT,
    "suggested_period" TEXT,
    "suggestion_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "error" TEXT,
    "validation_status" TEXT NOT NULL DEFAULT 'none',
    "validation_report" JSONB,
    "validated_fingerprint" TEXT,
    "validated_at" TIMESTAMP(3),
    "content_sha256" TEXT,
    "duplicate_of_id" TEXT,
    "validation_confirmed_by" TEXT,
    "validation_confirmed_at" TIMESTAMP(3),
    "validation_confirmed_sha256" TEXT,
    "import_file_type" TEXT,
    "import_period" TEXT,
    "imported_ingestion_id" TEXT,
    "imported_fingerprint" TEXT,
    "imported_sha256" TEXT,
    "imported_file_type" TEXT,
    "imported_period" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drive_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_scan_run" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "trigger" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'running',
    "files_seen" INTEGER NOT NULL DEFAULT 0,
    "skipped_by_pattern" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "changed_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "drive_scan_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drive_file_drive_file_id_key" ON "drive_file"("drive_file_id");

-- CreateIndex
CREATE INDEX "drive_file_status_idx" ON "drive_file"("status");

-- CreateIndex
CREATE INDEX "drive_file_content_sha256_idx" ON "drive_file"("content_sha256");

-- CreateIndex
CREATE INDEX "drive_file_imported_ingestion_id_idx" ON "drive_file"("imported_ingestion_id");

-- CreateIndex
CREATE UNIQUE INDEX "drive_file_imported_sha256_imported_file_type_imported_peri_key" ON "drive_file"("imported_sha256", "imported_file_type", "imported_period");

-- CreateIndex
CREATE INDEX "drive_scan_run_started_at_idx" ON "drive_scan_run"("started_at");

