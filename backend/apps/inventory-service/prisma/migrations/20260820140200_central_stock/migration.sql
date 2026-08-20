-- Estoque do CD, por lote. Vem da aba `Estoque Central` da planilha.
--
-- Tabela própria, e não colunas em stock_snapshot, porque este dado é
-- lançado à mão (não derivado de venda × abastecimento) e tem validade — que
-- o sistema hoje perde inteira.

CREATE TABLE "central_stock_lot" (
    "id" SERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "ean" TEXT,
    "quantity" INTEGER NOT NULL,
    "expires_on" DATE,
    "received_on" DATE NOT NULL,
    "supplier_id" INTEGER,
    "unit_cost_cents" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "central_stock_lot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "central_stock_lot_sku_idx" ON "central_stock_lot"("sku");
CREATE INDEX "central_stock_lot_expires_on_idx" ON "central_stock_lot"("expires_on");
