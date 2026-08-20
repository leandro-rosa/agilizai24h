-- Atributos da unidade que hospeda a loja, vindos das abas `Clientes` e
-- `INVESTIMENTO` da planilha de relatórios.
--
-- Todos nullable: as 24 lojas existentes não têm esses dados, e um NOT NULL
-- aqui faria a migration falhar em base com dado real.

ALTER TABLE "store" ADD COLUMN "tax_id" TEXT;
ALTER TABLE "store" ADD COLUMN "client_code" TEXT;
ALTER TABLE "store" ADD COLUMN "opened_on" DATE;
ALTER TABLE "store" ADD COLUMN "headcount" INTEGER;
ALTER TABLE "store" ADD COLUMN "voltage" TEXT;
