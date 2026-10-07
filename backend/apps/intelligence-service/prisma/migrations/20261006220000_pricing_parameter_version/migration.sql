-- CreateTable
CREATE TABLE "pricing_parameter_version" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "values" JSONB NOT NULL,

    CONSTRAINT "pricing_parameter_version_pkey" PRIMARY KEY ("id")
);
