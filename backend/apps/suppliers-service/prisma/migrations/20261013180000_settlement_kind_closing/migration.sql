-- Um fechamento calculado pelo painel (vendas × custo de repasse combinado) é um tipo próprio de acerto: não entra no saldo corrido dos regulares.
ALTER TABLE "settlement" DROP CONSTRAINT "settlement_kind_known";
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_kind_known" CHECK ("kind" IN ('regular', 'legacy', 'closing'));
