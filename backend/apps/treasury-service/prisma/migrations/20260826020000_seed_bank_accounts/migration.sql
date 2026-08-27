-- As 6 contas que Anexo A nomeia (add-treasury-review-ui) — mesmo CNPJ,
-- razão social diferente por banco, "mudam raramente... sem necessidade de
-- tela de auto-cadastro nesta fase" (confirmado com a área financeira). Sem
-- isto o seletor de conta por fonte na tela de upload não teria nada para
-- listar: um gap bloqueante, não cosmético, descoberto ao implementar a
-- tela — mesma categoria de decisão que o seed de
-- add-treasury-classification-model.
--
-- Cada fonte da fila (TREASURY_SOURCES) mapeia para exatamente uma destas
-- contas; C6 tem duas (conta corrente e cartão), as demais uma só.
-- `last_digits` fica NULO até alguém digitar o final real pela tela —
-- nenhum dígito verdadeiro foi informado na conversa de requisitos.

INSERT INTO "bank_account" ("name", "kind", "institution", "status", "updated_at")
VALUES
  ('PagBank', 'checking', 'pagbank', 'active', CURRENT_TIMESTAMP),
  ('C6 Conta Corrente', 'checking', 'c6', 'active', CURRENT_TIMESTAMP),
  ('C6 Cartão de Crédito', 'credit_card', 'c6', 'active', CURRENT_TIMESTAMP),
  ('Nubank', 'checking', 'nubank', 'active', CURRENT_TIMESTAMP),
  ('Bradesco', 'checking', 'bradesco', 'active', CURRENT_TIMESTAMP),
  ('Itaú', 'checking', 'itau', 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
