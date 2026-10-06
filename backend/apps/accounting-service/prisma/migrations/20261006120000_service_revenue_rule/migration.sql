-- Mensalidade, coffee break e frutas (receita) chegam do tesouraria juntas,
-- como "Prestação de serviços (Ascenty)"; a regra em
-- rules/ascenty-revenue.rule.ts separa pelo valor da entrada. Estrutura do
-- negócio (qual conta usa qual regra), não dado da empresa. 3.1.03 deixa de
-- ser 'treasury_category': a regra já soma "Receita - Mensalidade" sozinha
-- e pula a conta se o billing-service já gravou linhas por loja.
UPDATE "account" SET auto_source = 'service_revenue_rule', treasury_category = NULL WHERE code IN ('3.1.03', '3.1.04', '3.1.05');
