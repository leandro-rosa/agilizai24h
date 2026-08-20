-- Os cinco domínios de back-office que saíram da planilha de relatórios:
-- fornecedores, tesouraria, contabilidade, faturamento e CAPEX.
--
-- Estes têm permissão de escrita, diferente de sales/supply/finance, porque
-- não existe ingestão automática para eles: o dado só entra pelo painel.

INSERT INTO "permission" ("name", "description") VALUES
  ('suppliers:read',  'Read the supplier registry'),
  ('suppliers:write', 'Create and update suppliers and their aliases'),
  ('treasury:read',   'Read bank and card transactions, mappings and acquirer fees'),
  ('treasury:write',  'Record and classify treasury transactions'),
  ('accounting:read', 'Read the chart of accounts, P&L and cash flow'),
  ('accounting:write','Post ledger entries and close statement periods'),
  ('billing:read',    'Read clients, contracts and invoices'),
  ('billing:write',   'Manage clients, contracts, invoices and revenue shares'),
  ('capex:read',      'Read store investments, investors and payback'),
  ('capex:write',     'Manage investment items and investor contributions');

-- O administrador recebe tudo. O CROSS JOIN da migration de seed original já
-- rodou, então precisa ser refeito para as permissões novas.
INSERT INTO "role_permission" ("role_id", "permission_id")
SELECT r.id, p.id FROM "role" r JOIN "permission" p ON p.name IN (
  'suppliers:read',  'suppliers:write',
  'treasury:read',   'treasury:write',
  'accounting:read', 'accounting:write',
  'billing:read',    'billing:write',
  'capex:read',      'capex:write'
) WHERE r.name = 'administrator';

-- O operador segue somente-leitura.
INSERT INTO "role_permission" ("role_id", "permission_id")
SELECT r.id, p.id FROM "role" r JOIN "permission" p ON p.name IN (
  'suppliers:read',
  'treasury:read',
  'accounting:read',
  'billing:read',
  'capex:read'
) WHERE r.name = 'operator';

UPDATE "role" SET "description" = 'Read-only access across every domain'
WHERE "name" = 'operator';
