-- Plano de contas: as linhas do DRE e do fluxo de caixa.
--
-- Derivado da planilha de relatórios (abas `DRE` e `Fluxo de caixa`). É
-- ESTRUTURA do negócio, não dado da empresa — por isso viaja com o schema,
-- pelo mesmo critério do seed de permissões do iam-service. Nenhum valor
-- financeiro é semeado aqui; só a forma do relatório.
--
-- `Deslocamento` (4.2.03) é conta-mãe de Gasolina e Pedágio, espelhando a
-- planilha. Sem esse vínculo as três somariam lado a lado e o total de
-- despesa variável sairia dobrado.

INSERT INTO "account" ("code", "label", "statement", "section", "sign", "per_store", "sort_order", "updated_at") VALUES
  ('3.1.01', 'Vendas lojas', 'pnl', 'gross_revenue', 1, true, 1, CURRENT_TIMESTAMP),
  ('3.1.02', 'Prestação de serviços (coffee break + frutas)', 'pnl', 'gross_revenue', 1, false, 2, CURRENT_TIMESTAMP),
  ('3.1.03', 'Mensalidades', 'pnl', 'gross_revenue', 1, false, 3, CURRENT_TIMESTAMP),
  ('3.1.04', 'Coffee break', 'pnl', 'gross_revenue', 1, false, 4, CURRENT_TIMESTAMP),
  ('3.1.05', 'Frutas', 'pnl', 'gross_revenue', 1, false, 5, CURRENT_TIMESTAMP),
  ('3.1.06', 'Taxa de conveniência', 'pnl', 'gross_revenue', 1, false, 6, CURRENT_TIMESTAMP),
  ('3.2.01', 'Impostos sobre a venda', 'pnl', 'deductions', -1, false, 7, CURRENT_TIMESTAMP),
  ('3.2.02', 'Taxas voucher', 'pnl', 'deductions', -1, false, 8, CURRENT_TIMESTAMP),
  ('3.2.03', 'Descontos', 'pnl', 'deductions', -1, false, 9, CURRENT_TIMESTAMP),
  ('3.2.04', 'Taxas da maquininha', 'pnl', 'deductions', -1, true, 10, CURRENT_TIMESTAMP),
  ('4.1.01', 'Compra de produtos — abastecimento', 'pnl', 'cogs', -1, true, 11, CURRENT_TIMESTAMP),
  ('4.1.02', 'Compra de produtos — coffee break', 'pnl', 'cogs', -1, false, 12, CURRENT_TIMESTAMP),
  ('4.1.03', 'Compra de produtos — frutas', 'pnl', 'cogs', -1, false, 13, CURRENT_TIMESTAMP),
  ('4.2.01', 'Repasse de vendas', 'pnl', 'variable_expenses', -1, true, 14, CURRENT_TIMESTAMP),
  ('4.2.02', 'Perdas e roubos', 'pnl', 'variable_expenses', -1, true, 15, CURRENT_TIMESTAMP),
  ('4.2.03', 'Deslocamento', 'pnl', 'variable_expenses', -1, false, 16, CURRENT_TIMESTAMP),
  ('4.2.04', 'Gasolina', 'pnl', 'variable_expenses', -1, false, 17, CURRENT_TIMESTAMP),
  ('4.2.05', 'Pedágio', 'pnl', 'variable_expenses', -1, false, 18, CURRENT_TIMESTAMP),
  ('4.2.06', 'Degustações', 'pnl', 'variable_expenses', -1, false, 19, CURRENT_TIMESTAMP),
  ('4.2.07', 'Marketing', 'pnl', 'variable_expenses', -1, false, 20, CURRENT_TIMESTAMP),
  ('4.3.01', 'Mensalidade touchpay', 'pnl', 'fixed_expenses', -1, false, 21, CURRENT_TIMESTAMP),
  ('4.3.02', 'Contador', 'pnl', 'fixed_expenses', -1, false, 22, CURRENT_TIMESTAMP),
  ('4.3.03', 'Pró-labore', 'pnl', 'fixed_expenses', -1, false, 23, CURRENT_TIMESTAMP),
  ('4.3.04', 'Luz', 'pnl', 'fixed_expenses', -1, false, 24, CURRENT_TIMESTAMP),
  ('4.3.05', 'ERP Conta Azul', 'pnl', 'fixed_expenses', -1, false, 25, CURRENT_TIMESTAMP),
  ('4.4.01', 'Juros de empréstimo', 'pnl', 'financial_expenses', -1, false, 26, CURRENT_TIMESTAMP),
  ('5.1.01', 'Vendas recebidas PIX', 'cashflow', 'receipts', 1, false, 27, CURRENT_TIMESTAMP),
  ('5.1.02', 'Recebimento crédito', 'cashflow', 'receipts', 1, false, 28, CURRENT_TIMESTAMP),
  ('5.1.03', 'Recebimento débito', 'cashflow', 'receipts', 1, false, 29, CURRENT_TIMESTAMP),
  ('5.1.04', 'Recebimento vouchers', 'cashflow', 'receipts', 1, false, 30, CURRENT_TIMESTAMP),
  ('5.1.05', 'Outros recebimentos', 'cashflow', 'receipts', 1, false, 31, CURRENT_TIMESTAMP),
  ('5.2.01', 'Compra de estoque', 'cashflow', 'opex', -1, false, 32, CURRENT_TIMESTAMP),
  ('5.2.02', 'Gasolina', 'cashflow', 'opex', -1, false, 33, CURRENT_TIMESTAMP),
  ('5.2.03', 'Pedágio', 'cashflow', 'opex', -1, false, 34, CURRENT_TIMESTAMP),
  ('5.2.04', 'Coffee break + frutas', 'cashflow', 'opex', -1, false, 35, CURRENT_TIMESTAMP),
  ('5.2.05', 'Despesas operacionais', 'cashflow', 'opex', -1, false, 36, CURRENT_TIMESTAMP),
  ('5.2.06', 'Pró-labore', 'cashflow', 'opex', -1, false, 37, CURRENT_TIMESTAMP),
  ('5.2.07', 'Impostos', 'cashflow', 'opex', -1, false, 38, CURRENT_TIMESTAMP),
  ('5.2.08', 'Contador', 'cashflow', 'opex', -1, false, 39, CURRENT_TIMESTAMP),
  ('5.2.09', 'Conta Azul ERP', 'cashflow', 'opex', -1, false, 40, CURRENT_TIMESTAMP),
  ('5.2.10', 'Sistema Touchpay', 'cashflow', 'opex', -1, false, 41, CURRENT_TIMESTAMP),
  ('5.2.11', 'Conta de luz', 'cashflow', 'opex', -1, false, 42, CURRENT_TIMESTAMP),
  ('5.3.01', 'Pagamento de empréstimo', 'cashflow', 'loans', -1, false, 43, CURRENT_TIMESTAMP),
  ('5.4.01', 'Equipamentos (freezer/geladeira)', 'cashflow', 'capex', -1, false, 44, CURRENT_TIMESTAMP),
  ('5.4.02', 'Fretes', 'cashflow', 'capex', -1, false, 45, CURRENT_TIMESTAMP),
  ('5.4.03', 'Cestos de freezer', 'cashflow', 'capex', -1, false, 46, CURRENT_TIMESTAMP),
  ('5.4.04', 'Envelopamento', 'cashflow', 'capex', -1, false, 47, CURRENT_TIMESTAMP),
  ('5.4.05', 'Móveis', 'cashflow', 'capex', -1, false, 48, CURRENT_TIMESTAMP),
  ('5.4.06', 'LED', 'cashflow', 'capex', -1, false, 49, CURRENT_TIMESTAMP),
  ('5.4.07', 'Maquininhas', 'cashflow', 'capex', -1, false, 50, CURRENT_TIMESTAMP),
  ('5.4.08', 'Comunicação visual', 'cashflow', 'capex', -1, false, 51, CURRENT_TIMESTAMP),
  ('5.4.09', 'Montagem de loja', 'cashflow', 'capex', -1, false, 52, CURRENT_TIMESTAMP),
  ('5.4.10', 'Ativação de loja no touchpay', 'cashflow', 'capex', -1, false, 53, CURRENT_TIMESTAMP),
  ('5.4.11', 'Leitor de código de barras', 'cashflow', 'capex', -1, false, 54, CURRENT_TIMESTAMP),
  ('5.4.12', 'Câmera de segurança', 'cashflow', 'capex', -1, false, 55, CURRENT_TIMESTAMP),
  ('5.4.13', 'Estoque inicial', 'cashflow', 'capex', -1, false, 56, CURRENT_TIMESTAMP);

UPDATE "account" SET "parent_id" = (SELECT "id" FROM "account" WHERE "code" = '4.2.03') WHERE "code" = '4.2.04';
UPDATE "account" SET "parent_id" = (SELECT "id" FROM "account" WHERE "code" = '4.2.03') WHERE "code" = '4.2.05';
