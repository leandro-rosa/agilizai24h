# Treasury Drive sync — cobertura de todos os bancos

## Contexto

A sincronização de extratos de tesouraria via Google Drive
(`docs/superpowers/specs/2026-09-29-treasury-statement-drive-sync-design.md`,
implementada em 2026-09-29/30) cobre hoje só Itaú e C6 — os únicos 2 dos 7
bancos de tesouraria (`TREASURY_SOURCES`) que tinham arquivo real na pasta
"Extratos" quando aquele desenho foi feito. Os outros 5
(`pagbank_statement`, `pagseguro_invoice`, `nubank_statement`,
`bradesco_statement`) já têm parser PDF pronto em
`treasury-ingestion/parsers/` — construído para o fluxo de upload manual —
mas nenhum deles é lido pelo Drive ainda.

Uma nova exploração da pasta real (2026-10-01) achou:

- **Os nomes das pastas de mês ganharam sufixo de ano**: `agosto-26`,
  `setembro-26` (antes, bare `agosto`/`setembro`) — mudança feita nos
  bastidores pelo próprio dono da pasta, não algo que o código controla.
  A config atual (`TREASURY_DRIVE_MONTH_FOLDERS=agosto,setembro`) não bate
  mais com isso.
- **`setembro-26` já tem arquivo real de 4 bancos**: `itau` (um `.xlsx`
  genuinamente enviado — Planilha Google *não* nativa, diferente do mês
  anterior), `c6` (extrato em `.xlsx`, fatura em **PDF** — mês anterior a
  fatura era Planilha nativa: o formato varia mês a mês para o mesmo
  banco), `nubank` (PDF real, texto legível, bate com o parser PDF já
  existente), `pagseguro` (ver achado abaixo).
- **A pasta "pagseguro" tem um arquivo `.pdf` que é na verdade um `.xlsx`
  disfarçado** — os bytes começam com `PK` (assinatura ZIP), não `%PDF`.
  O Drive reporta `mimeType: application/pdf` mesmo assim — ele confia só
  na extensão do arquivo, não inspeciona o conteúdo. Lido como planilha,
  o conteúdo é um extrato de conta corrente PagSeguro ("Banco: 290 -
  PagSeguro Internet S/A", colunas Data/Tipo/Descrição/Entradas/Saidas/
  Saldo) — ou seja, é `pagbank_statement` (extrato), não
  `pagseguro_invoice` (fatura), **apesar do nome da pasta ser
  "pagseguro"**. O nome da pasta não é um sinal confiável do `TreasurySource`
  exato; só do banco.
- **A fatura do C6 em PDF é protegida por senha.** Testado e confirmado
  contra o arquivo real de setembro: a senha funciona e o PDF é lido
  normalmente (9 páginas, valor e vencimento reais extraídos). O Nubank,
  por outro lado, não tem senha nenhuma — proteção por senha não é
  universal entre os bancos.
- **Bradesco não tem arquivo real em nenhum mês ativo** (`agosto-26`/
  `setembro-26`) — só um backfill antigo (`Bradesco jan-junho.xlsx`,
  dentro de `julho-26`, fora do padrão mensal). Sem arquivo real do mês
  pra verificar formato/detecção contra, fica de fora desta mudança —
  mesma disciplina de "nunca escrever parser sem dado real" que já valeu
  para Itaú/C6.

## Objetivo

Estender o scan/import do Drive pra reconhecer e importar **Itaú, C6
(extrato e fatura, nos dois formatos que cada um pode vir), Nubank e
PagSeguro/PagBank** — sem escrever nenhum parser de conteúdo novo pros
bancos que só aparecem em PDF: reaproveita os 4 parsers PDF já existentes
e testados (`nubank.parser.ts`, `pagbank.parser.ts`,
`pagseguro-invoice.parser.ts`, `c6-invoice.parser.ts` — este último já
reaproveitado parcialmente desde a mudança de ontem).

## Não-objetivos

- **Bradesco continua de fora** — sem arquivo real do mês pra verificar,
  não dá pra garantir que a detecção/parser funcionam contra o formato
  real. Fica como próximo incremento quando houver arquivo real.
- **Nenhuma mudança de UI.** `DriveFilesSection`/`DriveFileRow`/
  `DriveImportDialog` (admin, Task 14 de ontem) já tratam
  `detected_source` como qualquer valor de `TreasurySource` — não há
  hardcoding de "só Itaú/C6" na tela. `TREASURY_SOURCE_LABELS` já tem os
  7 rótulos. O botão "Sincronizar com o Drive" do Abastecimento (feito
  hoje) não é afetado — é um módulo diferente (`drive-source`, não
  `treasury-drive-source`).
- **Nenhuma mudança no contrato `treasury.raw-rows`** — os parsers PDF já
  existentes já produzem `TreasuryRawRow[]` no formato que
  `treasury-service` espera, idêntico ao fluxo de upload manual.
- **Sem suporte a senha por banco** — a senha configurada é tentada pra
  qualquer PDF que peça senha, não importa o banco. Se um banco futuro
  usar senha diferente da do C6, isso precisa de desenho próprio (ver
  Gaps conhecidos).

## Arquitetura

### Um único passo de leitura, três formatos possíveis

Hoje o scan assume que todo arquivo elegível é uma Planilha Google nativa
(`application/vnd.google-apps.spreadsheet`, lida via `exportSheet`) — e a
correção de ontem (achado #2 da revisão final) fez qualquer outro
`mimeType` virar "não reconhecido" sem nem tentar ler, pra nunca derrubar
o scan inteiro por causa de um arquivo estranho.

A mudança substitui esse fallback por uma tentativa real de leitura,
ainda dentro do mesmo `try/catch` por arquivo (nunca derruba o scan):

```
mimeType === GOOGLE_SHEET_MIME?
  → exportSheet() (como hoje)
  → sheets: SheetRows[]
senão:
  → baixa os bytes crus (files.get(alt=media) — nunca files.export,
    que só existe pra Planilha nativa)
  → olha os primeiros bytes:
      "PK\x03\x04" (zip)  → ExcelJS.readFile(bytes) → sheets: SheetRows[]
      "%PDF"              → extractPdfPages(bytes) → pages: PdfPage[]
                             (se pedir senha: tenta de novo com
                             TREASURY_DRIVE_PDF_PASSWORD, se configurada)
      nenhum dos dois      → não reconhecido (fingerprint de metadado,
                             como já é hoje pra qualquer arquivo ilegível)
```

Isso cobre os dois achados reais: o PagSeguro mentiroso (mimeType PDF,
bytes de zip — pego pelos bytes, não pelo mimeType) e a fatura C6
protegida (PDF real, mas com senha).

### Duas famílias de detecção de conteúdo, uma por formato

`detectTreasurySheetSource` (já existe) continua cobrindo todo conteúdo
que virou `SheetRows[]` — só precisa ganhar um padrão novo pro extrato
PagSeguro (cabeçalho `Data/Tipo/Descrição/Entradas/Saidas/Saldo` +
"PagSeguro Internet S/A" no texto), igual já faz pra Itaú/C6.

Uma função nova, `detectTreasuryPdfSource(pages: PdfPage[], bankFolderName): TreasurySource | null`,
cobre conteúdo que virou `PdfPage[]` — mesmo princípio (conteúdo real,
nunca nome de arquivo), olhando um texto característico de cada banco já
conhecido pelos próprios parsers existentes (ex.: "Movimentações" +
estrutura Nubank, "Sua fatura com vencimento" + estrutura C6). A pasta do
banco (`itau`/`c6`/`nubank`/`pagseguro`) ainda decide **qual conjunto**
de assinaturas checar — exatamente como a pasta já decide isso hoje pra
Sheets — mas não decide sozinha o `TreasurySource` exato (o caso
PagSeguro prova que pasta ≠ fonte).

### Roteamento pro parser certo

Depois de saber `detected_source` (um dos 7 valores reais) e o formato
(`sheets` ou `pages`), o import escolhe o parser:

| `detected_source` | Formato real visto | Parser |
|---|---|---|
| `itau_statement` | `.xlsx` real | `itau-statement-sheet.parser.ts` (já existe) |
| `c6_statement` | `.xlsx` real | `c6-statement-sheet.parser.ts` (já existe) |
| `c6_invoice` | Planilha nativa **ou** PDF | `c6-invoice-sheet.parser.ts` (já existe) **ou** `c6-invoice.parser.ts` (já existe, PDF) |
| `nubank_statement` | PDF | `nubank.parser.ts` (já existe, PDF) |
| `pagbank_statement` | `.xlsx` disfarçado de PDF | **novo**: `pagbank-statement-sheet.parser.ts` |

Só **um** parser novo nesta mudança: `pagbank_statement` em formato
planilha nunca foi lido por nenhum caminho existente (o
`pagbank.parser.ts` atual é PDF-only, pro formato antigo de upload
manual) — mas é um parser de planilha simples, seguindo exatamente o
padrão já estabelecido pelos parsers de Itaú/C6 de ontem (cabeçalho por
nome de coluna, nunca posição; rejeição explícita em vez de linha
silenciosamente descartada), contra os dados reais já capturados acima.

## Configuração

Duas mudanças em `TreasuryDriveConfig`/env:

- `TREASURY_DRIVE_MONTH_FOLDERS` — valor atualizado pra
  `agosto-26,setembro-26` (sem mudança de código, só o valor).
- `TREASURY_DRIVE_PDF_PASSWORD` (nova, opcional) — tentada só quando um
  PDF pedir senha; omitida, o arquivo cai em "não reconhecido" em vez de
  travar.
- Allowlist de pasta de banco (`isRecognizedBankFolder`) ganha `nubank` e
  `pagseguro` — `bradesco` fica de fora de propósito.

## Tratamento de erro

- Senha errada ou ausente quando o PDF pede → mesmo caminho de "não
  reconhecido" que qualquer arquivo ilegível já tem hoje — nunca trava o
  scan, nunca expõe a senha em log/erro.
- Arquivo cujos bytes não começam com `PK` nem `%PDF` (nem é Planilha
  nativa) → "não reconhecido", mesmo comportamento de ontem.
- `pagbank-statement-sheet.parser.ts` segue a mesma disciplina dos
  parsers de ontem: coluna obrigatória ausente rejeita o arquivo inteiro
  (`unrecognized_columns`), linha com data/valor ilegível vira rejeição
  por linha, nunca é silenciosamente descartada.

## Testes

- `detectTreasuryPdfSource`: testado com o texto real extraído do PDF da
  Nubank e da fatura C6 (capturado durante esta pesquisa), não texto
  inventado — mesma disciplina de "fixture de dado real" de ontem.
- `pagbank-statement-sheet.parser.ts`: fixture construída a partir das
  linhas reais lidas acima (`Data/Tipo/Descrição/Entradas/Saidas/Saldo`,
  valores reais de centavos).
- O roteamento de leitura (bytes → sniff → sheets/pages) é testado com um
  arquivo de cada assinatura real: Planilha nativa, `.xlsx` cru, `.pdf`
  disfarçado de zip, PDF real sem senha, PDF real com senha (usando
  `xlsxBuffer()`/um PDF gerado à mão pra fixture, nunca os arquivos reais
  baixados nesta pesquisa — que não sobrevivem entre sessões).
- Teste de aceitação manual real (mesmo molde da Tarefa 17 de ontem):
  rodar o scan contra a pasta real, confirmar que Itaú, C6 (extrato e
  fatura), Nubank e PagBank aparecem corretamente detectados, e que
  Bradesco (sem pasta reconhecida) nunca aparece.

## Gaps conhecidos

- Senha de PDF é única pra toda a integração (`TREASURY_DRIVE_PDF_PASSWORD`),
  não por banco — se um banco futuro vier com senha diferente da do C6,
  isso pede extensão do desenho (lista de senha por pasta de banco, ou
  por padrão de nome de arquivo).
- `pagbank_statement` nunca foi importado por nenhum caminho (nem manual,
  nem Drive) antes desta mudança — o parser de planilha é novo e só foi
  verificado contra um mês de dado real; o parser PDF antigo
  (`pagbank.parser.ts`) continua existindo para o caso raro de um mês vir
  em PDF de verdade em vez do zip-disfarçado-de-pdf visto este mês.
- Bradesco segue sem cobertura — primeiro incremento futuro quando houver
  arquivo real de um mês pra verificar.
