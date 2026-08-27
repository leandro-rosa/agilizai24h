## Why

`treasury-service` today stores bank/card transactions with a single closed `nature` axis
(`cogs | operating | administrative | investment`) built for the DRE, and a `CounterpartyMapping`
de-para that resolves a favorecido to exactly that. It has no way to say a lançamento is not an
expense at all — a transfer between the company's own accounts, a card-bill payment, a CDB
movement, a loan, a partner draw — so every one of those either has to be force-fit into one of
the four DRE buckets or left unclassified. It also has no notion of "this favorecido was paid
from two accounts this month, sum it once", and no way to mark two lançamentos (a Pix recusado
and its estorno, or a devolução and the saída it cancels) as a wash that must not count on
either side.

Finance's real monthly reconciliation process — walking PagBank, C6, Nubank, Bradesco and Itaú
plus the C6 credit card invoice — depends on exactly these distinctions, worked out by hand
today. This change gives `treasury-service` the data model and rule engine that process needs,
so a later change (statement ingestion) can automate applying it and a dashboard can present it.

## What Changes

- **New `kind` axis on `BankTransaction`**: `revenue | expense | movement | pending`, orthogonal
  to the existing DRE `nature`. `nature` stays meaningful only for `kind = expense`.
- **`category` becomes a semi-curated field**: still free text (a new fornecedor shows up most
  weeks), but seeded with finance's confirmed list (Estoque, Frete, Contador, Equipamento,
  Combustível, Alimentação, Estacionamento, Financeiro/Tributos, Decoração de loja nova, ...) and
  exposed through a lookup endpoint the UI can offer as suggestions.
- **`CounterpartyMapping` gains `kind` and `match_type` (`exact | contains`)**. `exact` is today's
  behavior (default, backward compatible); `contains` is new, for keyword rules like "counterparty
  text contains POSTO ⇒ Combustível" that can't be expressed as one exact favorecido.
- **Own-entity movement detection**: the three razões sociais that share the company's CNPJ
  (Barbara Oliveira Fernandes Ltda, F&R Soluções Experience, Agiliz.Ai Ltda) are seeded as
  `kind = movement` mapping rules, so a Pix between them is never counted as revenue or expense
  regardless of value.
- **Neutralization**: a `BankTransaction` can be linked to the transaction it cancels
  (`neutralized_with_id`, self-referential, same month only). Both sides are excluded from every
  revenue/expense total. A new endpoint suggests candidate pairs (same value, same day, opposite
  direction, or a same-month devolução against a recent saída to the same resolved fornecedor) for
  a human to confirm — matching is a suggestion, never silent.
- **Cross-account fornecedor consolidation**: a new summary endpoint totals `expense` transactions
  by resolved `supplier_id` across every account in a period, instead of per account.
- **Editing a confirmed transaction's classification** (`kind`, `category`, `nature`,
  `supplier_id`) becomes an explicit, spec'd capability — today's `PATCH` exists but no requirement
  describes it.
- **Seed data**: the ~30 fornecedor→categoria rules, the 3 own-entity rules, and the
  fatura/CDB/empréstimo/sócio movement patterns finance has already confirmed, loaded as
  `CounterpartyMapping` rows editable afterward through the existing `/treasury/mappings` screen.

Out of scope for this change: reading any file (statement/invoice), the review/confirm workflow,
and the admin dashboard — each is its own change layered on top of this data model.

## Capabilities

### New Capabilities

- `treasury`: the bank/card ledger's classification behavior — the `kind`/`category`/`nature`
  taxonomy, mapping-rule resolution (exact and keyword), own-entity movement detection,
  neutralization pairing, cross-account fornecedor consolidation, and editing a classified
  transaction. No spec exists for `treasury-service` today; this change writes its first one.

### Modified Capabilities

None — no other capability's spec changes.

## Impact

- **Modified**: `backend/apps/treasury-service` — `prisma/schema.prisma` (new columns + migration),
  `treasury.service.ts`, `treasury.dto.ts`, `treasury-vocabulary.ts`, a new seed script.
- **Modified**: `backend/apps/gateway-service` — new/changed routes on `TreasuryController` for the
  consolidation and neutralization-suggestion endpoints, and the relaxed/extended transaction DTO.
- **Modified**: `frontend/apps/admin` — `src/lib/api/treasury.ts` types and `/treasury/mappings`
  form gain `kind`/`match_type` fields (minimal touch; the review UI and dashboard are separate
  changes).
- **Depends on**: nothing new — `treasury-service` already owns its Postgres and has no queue
  today; this change does not add one (classification stays synchronous CRUD; ingestion's own
  change is where queued processing is introduced).
- **Enables**: `add-treasury-statement-ingestion` (auto-classifies staged rows using this engine),
  `add-treasury-dashboard` (reads the new consolidation/summary shape).
