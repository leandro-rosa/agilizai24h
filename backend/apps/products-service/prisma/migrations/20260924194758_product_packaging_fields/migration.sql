-- AlterTable
ALTER TABLE "product" ADD COLUMN     "fractionable" BOOLEAN,
ADD COLUMN     "package_type" TEXT,
ADD COLUMN     "units_per_package" INTEGER;
