## Why

`/treasury`'s current summary (Entradas, Saídas, Saldo, and a flat "saída por natureza" list) predates
the `kind` taxonomy and cross-account consolidation `add-treasury-classification-model` introduces,
and predates the pending/movement distinction the whole reconciliation project is built around. It
was confirmed directly with finance, section by section, during the requirements conversation:
resumo cards for entrada/despesa/pendente/movimentação, despesa por categoria, despesa por
fornecedor consolidated across accounts, and a pendentes list — replacing the flat summary with the
structure finance actually reviews every month.

## What Changes

- **Resumo cards**: Entrada consolidada, Despesa confirmada, Pendente, Movimentação (informational)
  — replacing today's Entradas/Saídas/Saldo three-card row, which does not distinguish a real
  expense from a movement or a still-unresolved line.
- **Despesa por categoria**: one row per category (Estoque, Frete, Contador, Equipamento,
  Combustível, Alimentação, Estacionamento, Financeiro/Tributos, Decoração de loja nova, ...) with
  the period total — replacing today's flat "saída por natureza" (four DRE buckets), which finance
  never asked for and does not match how she reviews spend.
- **Despesa por fornecedor**: within (or alongside) each category, the fornecedor consolidation
  from `add-treasury-classification-model` — one total per fornecedor across every account it was
  paid from that period, not one line per account.
- **Pendentes list**: a dedicated section listing every `kind: pending` transaction for the period
  (Itaú SISPAG lines not yet resolved, or anything else unclassified), distinct from the existing
  "sem fornecedor" badge on individual rows, which stays but no longer is the only signal.
- **Movimentação section**: informational — transfers between own accounts, fatura payments, CDB,
  empréstimos, retiradas de sócio — visible for context, never folded into the expense total.

Out of scope: the upload/review workflow (`add-treasury-review-ui`) and the underlying data model
(`add-treasury-classification-model`) — this change only reads what those two produce.

## Capabilities

### New Capabilities

- `treasury-dashboard`: the `/treasury` summary's presentation — which sections exist, what each
  one includes and excludes, and how a period's confirmed lançamentos are grouped for review.

### Modified Capabilities

None.

## Impact

- **Modified**: `frontend/apps/admin/src/app/(app)/treasury/page.tsx` — the summary block (today's
  `SummaryCard` row + "Saída por natureza" card) is replaced; the transaction table below it is
  unchanged (already covered by `add-treasury-review-ui`'s edit-in-place addition).
- **Modified**: `frontend/apps/admin/src/lib/api/treasury.ts` — consumes the
  `by-supplier`/`categories` endpoints and the extended `summary` shape (`movement_cents`,
  `pending_count`/`pending_cents`) from `add-treasury-classification-model`.
- **Depends on**: `add-treasury-classification-model` for the data this screen presents. Does not
  depend on `add-treasury-statement-ingestion`/`add-treasury-review-ui` functionally (it renders
  whatever confirmed transactions exist, whether entered by hand or via import), but is only
  actually useful once one of those two produces real monthly data.
- **User-visible**: this is the screen finance opens every month once reconciliation is done —
  the confirmed deliverable from the requirements conversation.
