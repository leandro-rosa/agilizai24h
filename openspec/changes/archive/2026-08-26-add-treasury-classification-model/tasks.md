## 1. Schema migration

- [x] 1.1 Add `BankTransaction.kind` (`revenue | expense | movement | pending`), nullable at
      first
- [x] 1.2 Add `BankTransaction.neutralized_with_id` (nullable, self-FK to `BankTransaction.id`)
- [x] 1.3 Make `BankTransaction.nature` nullable (was required) — conditionally required at the
      DTO/service layer instead (design D1)
- [x] 1.4 Add `CounterpartyMapping.kind` (`revenue | expense | movement`) and `match_type`
      (`exact | contains`, default `'exact'`)
- [x] 1.5 Add indexes: `BankTransaction(kind, period)`, `BankTransaction(neutralized_with_id)`
- [x] 1.6 Backfill migration: set `kind = 'expense'` on every existing `BankTransaction` row
      (design Migration Plan step 2), then make `kind` `NOT NULL`

## 2. DTOs and validation

- [x] 2.1 `CreateTransactionDto`/`UpdateTransactionDto`: add `kind`, make `nature` conditionally
      required (required iff `kind === 'expense'`, rejected otherwise) and `supplier_id` allowed
      regardless of kind
- [x] 2.2 `CreateTransactionDto`: add optional `neutralized_with_id`
- [x] 2.3 `CreateMappingDto`/`UpdateMappingDto`: add `kind`, `match_type` (default `'exact'` when
      omitted, matching today's implicit behavior)
- [x] 2.4 Validate `neutralized_with_id` references a transaction in the same `period` when
      provided (design D5/D6 — same-month only)

## 3. Classification resolution

- [x] 3.1 Extend `normalizeCounterparty` usage: resolution now checks `exact` mappings first
      (existing behavior via `match_text` unique lookup), then `contains` mappings if no exact
      match
- [x] 3.2 `contains` resolution: when multiple `contains` rules match the same counterparty text,
      the rule with the longest `match_text` wins (design Risks — deterministic tie-break)
- [x] 3.3 A resolved mapping sets `kind`, `category`, `supplier_id`, and `nature` (only when
      `kind === 'expense'`) on the transaction
- [x] 3.4 A transaction with no resolved mapping is created/left as `kind: 'pending'`
- [x] 3.5 `applyMappings(period)` continuation: still only touches rows with `supplier_id: null`
      for `expense`-bound mappings; for `movement`-kind mappings (own-entity, fatura, CDB,
      empréstimo, sócio), reclassify any matching `pending` row regardless of `supplier_id`
      (a movement never has a resolvable `supplier_id` to begin with)

## 4. Summary and consolidation endpoints

- [x] 4.1 `summary(filter)`: exclude `kind: movement` and `kind: pending` rows from
      `inflow_cents`/`outflow_cents`/`by_nature`; add separate `movement_cents` and
      `pending_count`/`pending_cents` to the response shape
- [x] 4.2 New endpoint: `GET /treasury/transactions/by-supplier?period=` — sums `expense`
      transactions by `supplier_id` across every `account_id` in the period (spec: cross-account
      consolidation)
- [x] 4.3 New endpoint: `GET /treasury/categories` — distinct `category` values in use, seeded
      list included even before first use (design D2)
- [x] 4.4 Route both through `gateway-service`'s `TreasuryController` behind `TREASURY_READ`

## 5. Neutralization

- [x] 5.1 New endpoint: `GET /treasury/transactions/neutralization-candidates?period=` — returns
      candidate pairs: (a) opposite-direction, same value, same day, same account; (b) an inflow
      matching a recent same-period outflow to the same resolved `supplier_id` and same value
- [x] 5.2 New endpoint: `POST /treasury/transactions/neutralize` — body names two transaction IDs
      in the same period, sets `neutralized_with_id` on both; reject if either is already linked
      or the two are in different periods
- [x] 5.3 New endpoint: `POST /treasury/transactions/:id/unneutralize` — clears the link on both
      sides (a confirmed pair can be undone if it turns out wrong)
- [x] 5.4 Route all three through the gateway behind `TREASURY_READ` (candidates) /
      `TREASURY_WRITE` (neutralize/unneutralize)

## 6. Seed data

- [x] 6.1 Seed script (idempotent — skip-and-report on unique-constraint conflict, never fail the
      whole batch, design Migration Plan step 3): the 3 own-entity mapping rules (Barbara Oliveira
      Fernandes Ltda, F&R Soluções Experience, Agiliz.Ai Ltda), `kind: movement`
- [x] 6.2 Seed the ~30 confirmed fornecedor→categoria mapping rules (Anexo A of the requirements
      handoff), `kind: expense` with `nature`/`category` per the table, except Portoseg/Gerson and
      Josias/Barbara which are `kind: movement`
- [x] 6.3 Seed the fatura/CDB/empréstimo movement patterns per bank ("PGTO FAT CARTAO C6", "Cartão
      PagBank - Pagamento de Fatura", "CDB C6 LIM.GARANT.", "EMISSAO DE CDB", "RESGATE DE CDB"),
      `match_type: exact`, `kind: movement`
- [x] 6.4 Seed the financeiro/tributos patterns ("SEGURO CONTA C6", "JUROS CHEQUE ESP", "IOF
      CHEQUE ESPECIAL", "SIMPLES NACIONAL", "RECEITA FEDERAL"), `kind: expense`,
      `category: "Financeiro/Tributos"`
- [x] 6.5 Seed the keyword rules, `match_type: contains`, `kind: expense`: combustível ("posto",
      "ethanol", "shell", "servicos automotivos p" → `category: "Combustível"`), alimentação
      ("restauran", "lanchonete", "grill", "kfc", "burger king", "churrasco", "bakery", "rede de
      restau", "rodosnack", "frangoassado", "josy", "sertao amigao" → `category: "Alimentação"`),
      estacionamento ("parking", "rodovia bandeirantes" → `category: "Estacionamento"`)
- [x] 6.6 Document every seeded rule's source (which section of Anexo A) in the seed script's
      comments, so a future correction can find where the rule came from

## 7. Admin — minimal touch

- [x] 7.1 `src/lib/api/treasury.ts`: add `kind`, `match_type`, `neutralized_with_id` to
      `BankTransaction`/`CounterpartyMapping` types; add `useGetTransactionsBySupplierQuery`,
      `useGetCategoriesQuery`, `useGetNeutralizationCandidatesQuery`,
      `useNeutralizeTransactionsMutation`
- [x] 7.2 `/treasury/mappings` form (`ResourceFormDialog` fields): add `kind` and `match_type`
      selects, so the ~30 seeded rules are editable through the existing screen without waiting
      for the review-UI change

## 8. Tests

- [x] 8.1 Unit: exact vs. contains resolution, including the longest-match tie-break (3.2)
- [x] 8.2 Unit: `nature` required iff `kind === 'expense'`, rejected otherwise
- [x] 8.3 Unit: `summary()` excludes `movement`/`pending` from totals, includes them in their own
      counters
- [x] 8.4 Unit: by-supplier consolidation sums across two different `account_id`s to one total
- [x] 8.5 Unit: neutralization candidate detection finds the Pix-recusado/estornado shape (same
      value, same day, opposite direction) and the devolução-vs-recent-saída shape
- [x] 8.6 Unit: neutralized pair excluded from both totals; `unneutralize` restores them
- [x] 8.7 Unit: neutralize rejects a pair spanning two different periods
- [x] 8.8 Integration: seed script runs twice without erroring or duplicating rows
- [x] 8.9 Integration: `applyMappings` still only touches `supplier_id: null` rows for
      `expense`-kind mappings, and reclassifies matching `pending` rows for `movement`-kind ones

## 9. Documentation

- [x] 9.1 Update `backend/apps/treasury-service/CLAUDE.md`: the `kind` axis and its relationship
      to `nature`, `match_type`, neutralization, the seed script, and the new endpoints
- [x] 9.2 Update `backend/apps/gateway-service/CLAUDE.md` treasury routes table with the four new
      endpoints and their permissions

## 10. Verification

- [x] 10.1 `pnpm turbo run lint typecheck build test` green across the workspace
- [x] 10.2 `prisma migrate deploy` runs clean against a fresh database and against a database
      already carrying today's `BankTransaction` rows (backfill path)
- [x] 10.3 Manually verify in `/treasury/mappings`: edit a seeded rule's `kind`, confirm it
      persists and is reflected on the next `applyMappings` run
- [x] 10.4 `openspec validate add-treasury-classification-model --strict` passes
