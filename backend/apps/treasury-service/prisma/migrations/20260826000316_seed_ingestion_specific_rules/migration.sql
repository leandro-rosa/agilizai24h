-- Regras que só passam a importar quando lançamento real do Nubank/C6 existe
-- (add-treasury-statement-ingestion, tasks 4.1/4.2 — Anexo A, seção "Nubank").
--
-- Nota sobre a regra "AGILIZ.AI LTDA recebido no C6" (task 4.2): já está
-- coberta pela regra own-entity 'AGILIZ AI LTDA' semeada em
-- add-treasury-classification-model (match exato, kind: movement) — o
-- mecanismo de de-para não é escopado por conta, então essa mesma regra já
-- vale tanto para o Nubank quanto para o C6. Não seedada de novo aqui: o
-- unique de `match_text` impediria uma segunda linha com o mesmo texto, e
-- duplicar a regra não mudaria o resultado.

INSERT INTO "counterparty_mapping"
  ("match_text", "display_name", "entry_type", "category", "kind", "nature", "match_type", "updated_at")
VALUES
  ('COMPANHIA BRASILEIRA DE DISTRIBUICAO AUTOMOTIVA S A', 'Companhia Brasileira de Distribuição Automotiva S A (pessoal)', 'pessoal', 'Pessoal', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('IFOOD PAGO', 'iFood Pago (pessoal)', 'pessoal', 'Pessoal', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('ROSTI SERVICOS ADMINISTRATIVOS', 'Rosti Serviços Administrativos (pessoal)', 'pessoal', 'Pessoal', 'movement', NULL, 'exact', CURRENT_TIMESTAMP)
ON CONFLICT ("match_text") DO NOTHING;
