-- CreateTable
CREATE TABLE "treasury_drive_file" (
    "id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "month_folder_name" TEXT NOT NULL,
    "bank_folder_name" TEXT NOT NULL,
    "detected_source" TEXT,
    "name" TEXT NOT NULL,
    "modified_time" TIMESTAMP(3) NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "imported_at" TIMESTAMP(3),
    "imported_account_id" INTEGER,
    "error_detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treasury_drive_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "treasury_drive_file_drive_file_id_key" ON "treasury_drive_file"("drive_file_id");
