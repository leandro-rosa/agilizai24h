-- A 7ª fonte (add-treasury-statement-ingestion design D11, descoberta ao
-- validar as 6 originais contra arquivos reais): a fatura do cartão
-- PagSeguro/PagBank é um arquivo genuinamente distinto do extrato da conta
-- corrente PagBank ("PagBank" já seedada em 20260826020000), com sua própria
-- conta. Mesmo institution ("pagbank") das outras contas PagBank — o
-- titular na fatura real é "Barbara" (pessoa física), não uma razão social
-- separada, confirmando ser o mesmo relacionamento bancário, só que produto
-- cartão em vez de conta corrente. `kind: credit_card`, mesmo padrão que a
-- C6 já usa para suas duas contas (checking + credit_card).

INSERT INTO "bank_account" ("name", "kind", "institution", "status", "updated_at")
VALUES
  ('PagSeguro Cartão de Crédito', 'credit_card', 'pagbank', 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
