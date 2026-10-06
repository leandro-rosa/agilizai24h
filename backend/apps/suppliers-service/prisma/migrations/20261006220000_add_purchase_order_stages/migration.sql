-- AlterTable
ALTER TABLE "purchase"
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'received',
    ADD COLUMN "created_by" TEXT,
    ADD COLUMN "sent_at" TIMESTAMP(3),
    ADD COLUMN "sent_by" TEXT,
    ADD COLUMN "invoiced_at" TIMESTAMP(3),
    ADD COLUMN "invoiced_by" TEXT,
    ADD COLUMN "without_invoice" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "received_on" DATE,
    ADD COLUMN "received_at" TIMESTAMP(3),
    ADD COLUMN "received_by" TEXT,
    ADD COLUMN "expected_delivery_on" DATE,
    ADD COLUMN "payment_term" TEXT,
    ADD COLUMN "payment_due_on" DATE;

-- AlterTable
ALTER TABLE "purchase_item" ADD COLUMN "received_quantity" INTEGER;

-- Purchases recorded before the stages are facts already received: they keep counting, on the same date.
UPDATE "purchase" SET "received_on" = "ordered_on", "received_at" = "created_at" WHERE "status" = 'received';
UPDATE "purchase_item" SET "received_quantity" = "quantity";

-- CreateTable
CREATE TABLE "purchase_event" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_email" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "has_attachment" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL,
    "error" TEXT,
    "message_id" TEXT,
    "sent_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_status_idx" ON "purchase"("status");

-- CreateIndex
CREATE INDEX "purchase_event_purchase_id_idx" ON "purchase_event"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_email_purchase_id_idx" ON "purchase_email"("purchase_id");

-- AddForeignKey
ALTER TABLE "purchase_event" ADD CONSTRAINT "purchase_event_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_email" ADD CONSTRAINT "purchase_email_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
