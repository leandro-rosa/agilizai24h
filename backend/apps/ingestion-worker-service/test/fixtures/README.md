# Fixtures

Small, real files cut from the operators' actual exports. The full exports —
7 months, 106 sales files, 7 restocking workbooks, the price list — are not
committed; they live outside the repo, in
`var/exemplos-de-planilhas/agiliz.ai-20260818T230206Z-1-001/`. See
`openspec/changes/archive/*/align-ingestion-with-real-reports/design.md` for
the analysis these fixtures back.

Every value in every fixture is real, cut from a real row. Nothing here is
synthesized — the point of these fixtures is to catch a parser that only
handles the format we imagined.

## Files

- **`real-sales.xlsx`** — first 5 rows of
  `Vendas x abastecimento/fevereiro-26/venda Ascenty - SP02 fev.xlsx`.
  Confirms every real sales row is accepted (today, none would be).

- **`real-restocking.xlsx`** — three sheets, one of each operation kind:
  - `Operação 1` (Abastecimento) — 5 rows from
    `abril-26/Abastecimentos 2026-04-01 _ 2026-04-30 (2).xlsx`, `Operação 26`
    (Cliente: Ascenty - JDI01). The last row was replaced with a real
    mixed-reason removal from the same file's `Operação 38`
    (`-1 Outro motivo, -1 Validade vencida`) — the wrong-column regression
    this whole change exists to fix reads this column, so a fixture without a
    populated `Detalhes das Remoções` wouldn't exercise it.
  - `Operação 2` (Inventário) — 5 rows from
    `março-26/Abastecimentos 2026-03-01 _ 2026-03-31 (8).xlsx`, `Operação 21`
    (Cliente: Ascenty - SP03 Copa) — the smallest real Inventário operation
    found carrying a non-zero `Diferença` (4 of its rows do; a 5th with none
    was kept alongside for contrast).
  - `Operação 3` (Combinado) — 6 rows from
    `julho-26/Abastecimentos 2026-07-01 _ 2026-07-31.xlsx`, `Operação 1`
    (Cliente: Rolls-Royce) — carries a real `Qtd. abastecida` on every row,
    the case that exercises "a combined operation contributes to both
    totals."

  The balance identity (`Qtd. final = Qtd. Anterior + Qtd. abastecida +
  Remoções + Diferença`) holds on every row here, same as the full export.

- **`real-price-list.xlsx`** — first 8 rows of the `PREÇOS` sheet from
  `Relatórios/agiliz.ai - abastecimento.xlsx`. Real `sku`, `Produto`, `Custo`.

- **`missing-column.xlsx`** — a restocking sheet built from the real column
  vocabulary with `Detalhes das Remoções` dropped entirely. Exercises "fail a
  file missing a required column, naming it."

- **`broken-balance.xlsx`** — a restocking sheet with one row whose
  `Qtd. final` (99) does not equal `Qtd. Anterior + Qtd. abastecida +
  Remoções + Diferença` (6). Exercises "report a row that does not balance."

- **`multi-operation-same-store.xlsx`** — two sheets, both `Cliente: Ascenty
  - JDI01`, same SKU (6098) restocked in each (6, then 4). Never observed as
  two SEPARATE sheets in the real export within one file (a store is usually
  one sheet per visit, but the export does carry a store across several
  operations in a month — see design "Context"), so this is built rather than
  cut, using the real column vocabulary. Exercises "one store restocked
  several times sums, rather than the last one winning."

- **`unresolved-store.xlsx`** — two sheets: one names a real-shaped store
  (`Ascenty - JDI01`), the other names `Loja Fantasma Que Nao Existe`, which
  resolves to no registered store. Exercises "an unresolved store fails only
  its own operation, while its siblings ingest."

- **`unexpected-adjustment.xlsx`** — one `Abastecimento`-kind operation whose
  row carries a non-zero `Diferença` (-2). Never observed in the real
  export — 0 of 89,252 rows — so this is the deliberately-impossible case:
  exercises "a non-zero adjustment on a restocking-kind operation is
  reported as inconsistent, not silently accumulated" (design D1's
  fail-loud philosophy, applied to a shape the export has never actually
  produced).

## Regenerating

Cut with `xlsx` (`XLSX.readFile` / `XLSX.utils.sheet_to_json` /
`XLSX.utils.aoa_to_sheet` / `XLSX.writeFile`), reading directly from the
source files under `var/exemplos-de-planilhas/`. There is no committed
script — these were built by hand for this change, at the specific rows
named above, and the workbook layout is what matters, not the tool.
