-- AlterTable
ALTER TABLE "minimum_level" ADD COLUMN     "current_quantity" INTEGER,
ADD COLUMN     "current_quantity_as_of" TIMESTAMP(3),
ADD COLUMN     "par_level" INTEGER,
ALTER COLUMN "minimum" DROP NOT NULL;
