-- AlterTable
ALTER TABLE "stock_snapshot" ADD COLUMN     "adjustment" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disputed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recorded_closing_balance" INTEGER;
