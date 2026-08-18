-- Structural seed: roles and permissions are facts of the system, not
-- per-environment configuration, so they ship with the schema. The names
-- mirror @app/iam-contracts, which is the single source both this seed and
-- gateway-service read from.

INSERT INTO "permission" ("name", "description") VALUES
  ('stores:read', 'Read the store registry'),
  ('stores:write', 'Create and update stores'),
  ('products:read', 'Read the product catalogue and cost reference'),
  ('products:write', 'Manage products and cost versions'),
  ('sales:read', 'Read sales records'),
  ('supply:read', 'Read restock and removal records'),
  ('inventory:read', 'Read stock levels'),
  ('inventory:write', 'Configure minimum stock levels'),
  ('finance:read', 'Read the monthly reconciliation'),
  ('ingestion:upload', 'Upload operational spreadsheets'),
  ('ingestion:read', 'Read ingestion status and errors'),
  ('users:read', 'Read operator accounts'),
  ('users:write', 'Create and manage operator accounts');

INSERT INTO "role" ("name", "description") VALUES
  ('administrator', 'Full access to every permission'),
  ('operator', 'Read-only access across the six domains');

INSERT INTO "role_permission" ("role_id", "permission_id")
SELECT r.id, p.id FROM "role" r CROSS JOIN "permission" p WHERE r.name = 'administrator';

INSERT INTO "role_permission" ("role_id", "permission_id")
SELECT r.id, p.id FROM "role" r JOIN "permission" p ON p.name IN (
  'stores:read',
  'products:read',
  'sales:read',
  'supply:read',
  'inventory:read',
  'finance:read',
  'ingestion:read'
) WHERE r.name = 'operator';
