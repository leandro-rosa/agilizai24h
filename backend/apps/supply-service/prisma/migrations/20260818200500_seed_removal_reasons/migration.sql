-- The six removal reasons and their loss classification.
--
-- Structural facts validated against several months of production data from
-- the source system, not per-environment configuration — so they ship with
-- the schema. Generated from src/modules/supply/constants/removal-reasons.ts
-- so the seed and the constant cannot drift.
--
-- Expired, damaged product and other reason count as real loss.
-- Return, transfer and internal use do not: the units left the shelf, but
-- nothing was lost.

INSERT INTO "removal_reason" ("key", "label", "counts_as_loss") VALUES
  ('expired', 'Validade vencida', true),
  ('damaged_product', 'Produto danificado', true),
  ('other_reason', 'Outro motivo', true),
  ('return', 'Devolução', false),
  ('transfer', 'Transferência', false),
  ('internal_use', 'Uso e consumo', false);
