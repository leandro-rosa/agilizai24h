-- Regras de classificação confirmadas com a área financeira (add-treasury-
-- classification-model, requirements handoff "Anexo A"). É REGRA DE
-- NEGÓCIO estrutural — viaja com o schema, mesmo critério do seed de plano
-- de contas do accounting-service e de permissões do iam-service — não
-- dado de um mês específico. Toda regra continua editável depois pela tela
-- /treasury/mappings; isto só carrega o estado inicial confirmado.
--
-- `match_text` já é o texto NORMALIZADO (maiúsculo, sem acento/pontuação,
-- espaços colapsados) pelo mesmo algoritmo de `normalizeCounterparty` —
-- inserir aqui pulando a normalização quebraria silenciosamente a
-- resolução em runtime.
--
-- Casos do Anexo A DELIBERADAMENTE NÃO seedados aqui como regra de-para:
--   - PagSeguro Internet (linhas com favorecido em branco no PagBank):
--     `match_text` vazio não é um caso que este mecanismo resolve —
--     "favorecido em branco" é sinal do PARSER (add-treasury-statement-
--     ingestion), não uma grafia para casar.
--   - Edson Rafael De Souza Soares Ltda: não é fornecedor, é devolução de
--     Pix a um cliente — resolvido por NEUTRALIZAÇÃO caso a caso (par de
--     lançamentos), não por regra estática.
--   - As exclusões "não é dinheiro da empresa" do Nubank e a regra
--     "AGILIZ.AI LTDA recebido no C6" entram em add-treasury-statement-
--     ingestion (só importam quando lançamento real do Nubank/C6 existir).

-- ----- contas próprias (mesmo CNPJ, razões sociais diferentes) --------------
-- Qualquer Pix entre essas nunca é receita/despesa, não importa o valor.

INSERT INTO "counterparty_mapping"
  ("match_text", "display_name", "entry_type", "category", "kind", "nature", "match_type", "updated_at")
VALUES
  ('BARBARA OLIVEIRA FERNANDES LTDA', 'Barbara Oliveira Fernandes Ltda (PagBank)', 'movimentacao', 'Movimentação entre contas', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('F R SOLUCOES EXPERIENCE', 'F&R Soluções Experience (C6 / Itaú)', 'movimentacao', 'Movimentação entre contas', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('AGILIZ AI LTDA', 'Agiliz.Ai Ltda (Nubank)', 'movimentacao', 'Movimentação entre contas', 'movement', NULL, 'exact', CURRENT_TIMESTAMP)
ON CONFLICT ("match_text") DO NOTHING;

-- ----- fatura de cartão, CDB, empréstimo — sempre movimentação -------------

INSERT INTO "counterparty_mapping"
  ("match_text", "display_name", "entry_type", "category", "kind", "nature", "match_type", "updated_at")
VALUES
  ('CARTAO PAGBANK PAGAMENTO DE FATURA', 'Cartão PagBank - Pagamento de Fatura', 'movimentacao', 'Pagamento de fatura', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('PGTO FAT CARTAO C6', 'PGTO FAT CARTAO C6', 'movimentacao', 'Pagamento de fatura', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('CDB C6 LIM GARANT', 'CDB C6 LIM.GARANT.', 'movimentacao', 'CDB', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('EMISSAO DE CDB', 'Emissão de CDB', 'movimentacao', 'CDB', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('RESGATE DE CDB', 'Resgate de CDB', 'movimentacao', 'CDB', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('PORTOSEG', 'Portoseg', 'financiamento', 'Financiamento/empréstimo', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('GERSON OLIVEIRA DOS SANTOS', 'Gerson Oliveira Dos Santos', 'financiamento', 'Financiamento/empréstimo', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('JOSIAS OLIVEIRA DOS SANTOS', 'Josias Oliveira Dos Santos', 'socio', 'Sócios', 'movement', NULL, 'exact', CURRENT_TIMESTAMP),
  ('BARBARA OLIVEIRA FERNANDES', 'Barbara Oliveira Fernandes (sócia)', 'socio', 'Sócios', 'movement', NULL, 'exact', CURRENT_TIMESTAMP)
ON CONFLICT ("match_text") DO NOTHING;

-- ----- financeiro/tributos — despesa real, categoria própria ----------------

INSERT INTO "counterparty_mapping"
  ("match_text", "display_name", "entry_type", "category", "kind", "nature", "match_type", "updated_at")
VALUES
  ('SEGURO CONTA C6', 'Seguro Conta C6', 'financeiro', 'Financeiro/Tributos', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP),
  ('JUROS CHEQUE ESP', 'Juros Cheque Especial', 'financeiro', 'Financeiro/Tributos', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP),
  ('IOF CHEQUE ESPECIAL', 'IOF Cheque Especial', 'financeiro', 'Financeiro/Tributos', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP),
  ('SIMPLES NACIONAL', 'Simples Nacional', 'financeiro', 'Financeiro/Tributos', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP),
  ('RECEITA FEDERAL', 'Receita Federal', 'financeiro', 'Financeiro/Tributos', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP)
ON CONFLICT ("match_text") DO NOTHING;

-- ----- fornecedores confirmados (Anexo A, seção 5) --------------------------

INSERT INTO "counterparty_mapping"
  ("match_text", "display_name", "entry_type", "category", "kind", "nature", "match_type", "updated_at")
VALUES
  -- Equipamento (freezer/geladeira)
  ('PONTO FRIO EQUIPAMENTOS', 'Ponto Frio Equipamentos', 'equipamento', 'Equipamento', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('LIDER EQUIPAMENTOS', 'Lider Equipamentos', 'equipamento', 'Equipamento', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),

  -- Estoque (produtos revendidos, incl. congelados/geladinho)
  ('QUINOA INDUSTRIA DE ALIMENTOS', 'Quinoa Indústria de Alimentos', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('WILSON PEREIRA NETO', 'Wilson Pereira Neto', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('AMBEV', 'Ambev', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('EZE CREPERIE', 'Eze Creperie', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('NORAC DO BRASIL', 'Norac do Brasil', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('NUTRILATINO', 'Nutrilatino', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('LU TORELLI', 'Lu Torelli', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('LA FABRICA', 'La Fabrica', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('BIANCCA APOLINARIO', 'Biancca Apolinario (marmitas Mokaen)', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('MOKAEN ALIMENTACAO DE VERDADE', 'Mokaen Alimentação De Verdade', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('MERYELLEN DOS SANTOS PLAZA DUARTE', 'Meryellen Dos Santos Plaza Duarte (geladinho)', 'estoque', 'Estoque', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),

  -- Coffee break
  ('KELLY FERREIRA DE CASTRO', 'Kelly Ferreira De Castro (bolos, 100% coffee break)', 'coffee break', 'Coffee break', 'expense', 'operating', 'exact', CURRENT_TIMESTAMP),
  -- Edson mistura coffee break e revenda normal nas lojas (Anexo A) — uma
  -- regra só não separa por lançamento; default para Coffee break/operating,
  -- corrigir manualmente por lançamento quando for revenda.
  ('EDSON CLEMENTINO DE OLIVEIRA', 'Edson Clementino De Oliveira (salgados, misturado)', 'coffee break', 'Coffee break', 'expense', 'operating', 'exact', CURRENT_TIMESTAMP),

  -- Frutas (contrato Ascenty)
  ('CRISLAINE SILVA ROSA TORRES', 'Crislaine Silva Rosa Torres', 'frutas', 'Frutas', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('MARCIO LUIZ PIRES', 'Marcio Luiz Pires', 'frutas', 'Frutas', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('GIOVANNI APARECIDO DA SILVA', 'Giovanni Aparecido Da Silva', 'frutas', 'Frutas', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('BOX 108', 'Box 108', 'frutas', 'Frutas', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),
  ('LOURISVALDO FERREIRA MACIEL', 'Lourisvaldo Ferreira Maciel', 'frutas', 'Frutas', 'expense', 'cogs', 'exact', CURRENT_TIMESTAMP),

  -- Frete
  ('VALTEMIR DE JESUS SANTANA', 'Valtemir De Jesus Santana', 'frete', 'Frete', 'expense', 'operating', 'exact', CURRENT_TIMESTAMP),
  ('REINALDO RODRIGUES ALVAREZ', 'Reinaldo Rodrigues Alvarez', 'frete', 'Frete', 'expense', 'operating', 'exact', CURRENT_TIMESTAMP),
  ('ELISANGELA BENEDITO DOS SANTOS', 'Elisangela Benedito Dos Santos (frete + envelopamento, loja nova)', 'loja nova', 'Frete e envelopamento (loja nova)', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),

  -- Contador
  ('RICARDO RAMIRO NUNIS DA SILVA', 'Ricardo Ramiro Nunis Da Silva', 'contador', 'Contador', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP),
  ('UPGRADE CONTABILIDADE E CONSULTORIA', 'Upgrade Contabilidade E Consultoria', 'contador', 'Contador', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP),

  -- Decoração/comunicação visual/gráfica de loja nova
  ('ALLOGOS LASER', 'Allogos Laser', 'loja nova', 'Decoração de loja nova', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('BARRETO COMUNICACAO VISUAL', 'Barreto Comunicação Visual', 'loja nova', 'Decoração de loja nova', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('SAINTS COMUNICACAO VISUAL', 'Saints Comunicação Visual', 'loja nova', 'Decoração de loja nova', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('SHPP BRASIL', 'Shpp Brasil', 'loja nova', 'Decoração de loja nova', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('PIX MARKETPLACE', 'Pix Marketplace', 'loja nova', 'Decoração de loja nova', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('GRAPHIMAR IMPRESSOS', 'Graphimar Impressos', 'loja nova', 'Decoração de loja nova', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),

  -- Equipamento/móveis/manutenção
  ('OBRAMAX', 'Obramax', 'equipamento', 'Equipamento/móveis/manutenção', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('JR FERRO E ACO', 'Jr Ferro E Aço', 'equipamento', 'Equipamento/móveis/manutenção', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('GRAVEX', 'Gravex', 'equipamento', 'Equipamento/móveis/manutenção', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('MULTI CENTER', 'Multi Center', 'equipamento', 'Equipamento/móveis/manutenção', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('INFINITE MOVEIS', 'Infinite Moveis', 'equipamento', 'Equipamento/móveis/manutenção', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),
  ('MADEIRAMADEIRA', 'Madeiramadeira', 'equipamento', 'Equipamento/móveis/manutenção', 'expense', 'investment', 'exact', CURRENT_TIMESTAMP),

  -- Sistema Touchpay — R$652,20 é sempre ativação de loja nova (investment);
  -- o restante é mensalidade. Uma regra não separa por valor: default para
  -- mensalidade/administrative, corrigir manualmente a linha de R$652,20.
  ('AMLABS VENTURES', 'Amlabs Ventures (sistema Touchpay)', 'sistema', 'Sistema Touchpay', 'expense', 'administrative', 'exact', CURRENT_TIMESTAMP),

  -- Cliente — repasse de 5% do faturamento. Contabilmente é dedução de
  -- receita, não despesa operacional; o modelo de `kind` ainda não tem um
  -- bucket próprio para "dedução de receita" (gap conhecido, ver
  -- add-treasury-classification-model design.md). Seedado como expense/
  -- operating por ora — mais perto do real do que qualquer outro bucket.
  ('PLENA SAUDE', 'Plena Saúde (repasse de 5% do faturamento)', 'repasse', 'Repasse de receita (Plena Saúde)', 'expense', 'operating', 'exact', CURRENT_TIMESTAMP)
ON CONFLICT ("match_text") DO NOTHING;

-- ----- deslocamento (combustível, alimentação, estacionamento) -------------
-- Regra de palavra-chave: bate quando o favorecido normalizado CONTÉM o
-- texto, não quando é igual. Só aparece no débito C6 e na fatura C6
-- (Anexo A, seção 6) — despesa de deslocamento durante visita de
-- abastecimento, nunca estoque, mesmo saindo do mesmo cartão/conta que
-- fornecedor de produto.

INSERT INTO "counterparty_mapping"
  ("match_text", "display_name", "entry_type", "category", "kind", "nature", "match_type", "updated_at")
VALUES
  ('POSTO', 'Combustível (POSTO)', 'deslocamento', 'Combustível', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('ETHANOL', 'Combustível (ETHANOL)', 'deslocamento', 'Combustível', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('SHELL', 'Combustível (SHELL)', 'deslocamento', 'Combustível', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('SERVICOS AUTOMOTIVOS P', 'Combustível (SERVICOS AUTOMOTIVOS P)', 'deslocamento', 'Combustível', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('RESTAURAN', 'Alimentação (RESTAURAN)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('LANCHONETE', 'Alimentação (LANCHONETE)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('GRILL', 'Alimentação (GRILL)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('KFC', 'Alimentação (KFC)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('BURGER KING', 'Alimentação (BURGER KING)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('CHURRASCO', 'Alimentação (CHURRASCO)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('BAKERY', 'Alimentação (BAKERY)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('REDE DE RESTAU', 'Alimentação (REDE DE RESTAU)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('RODOSNACK', 'Alimentação (RODOSNACK)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('FRANGOASSADO', 'Alimentação (FRANGOASSADO)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('JOSY', 'Alimentação (JOSY)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('SERTAO AMIGAO', 'Alimentação (SERTAO AMIGAO)', 'deslocamento', 'Alimentação', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('PARKING', 'Estacionamento (PARKING)', 'deslocamento', 'Estacionamento', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP),
  ('RODOVIA BANDEIRANTES', 'Estacionamento (RODOVIA BANDEIRANTES)', 'deslocamento', 'Estacionamento', 'expense', 'operating', 'contains', CURRENT_TIMESTAMP)
ON CONFLICT ("match_text") DO NOTHING;
