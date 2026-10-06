-- AlterTable
ALTER TABLE "purchase" ADD COLUMN "payment_method" TEXT;

-- AlterTable
ALTER TABLE "purchase_item" ADD COLUMN "paid_method" TEXT;
