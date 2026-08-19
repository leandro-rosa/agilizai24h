---
name: fpa-business-profile
description: What is currently known about Agiliz.AI's business from repo evidence, and what financial inputs are still missing.
metadata:
  type: fact
---

# Business Profile — Agiliz.AI

## Established from repo evidence (FACT, with source)

- **Business model**: network of unattended micro-market stores (self-
  checkout convenience points) installed inside partner companies and
  condominiums in Brazil. Source: `openspec/project.md`.
- **Current POS platform**: third-party (touchpay/AmLabs) — the in-house
  platform being built (`backend/apps/*`) replaces a manual, spreadsheet-
  based monthly reconciliation of that operation. Source: `openspec/project.md`.
- **Revenue collection**: self-checkout, paid at the point of sale — no
  Accounts Receivable in the core model unless a specific host-company
  billing arrangement exists (unverified). Source: inferred from
  `openspec/project.md`'s domain model; not explicitly stated as a fact
  about AR.
- **At least one real corporate client**: "Ascenty" (data-center company),
  with multiple store locations at their Osasco/SP site (e.g. SP02, SP03,
  SP03-DH4, SP03 Copa). Source: `graphify-out/converted/Abastecimentos
  2026-04-01 _ 2026-04-30 (1)_a002bcac.md`, a converted operator spreadsheet
  export covering restocking operations for 2026-04-01–2026-04-30.
- **Product categories in active use**: Mercearia, Salgadinhos, Bebidas,
  Chocolates, Refrigerados, congelados, snacks proteicos, among others.
  Source: same Abastecimentos export.
- **Loss classification rules**, validated against several months of real
  production data: Expired, Damaged product, and Other reason count as real
  loss; Return, Transfer, and Internal use do not. A single removal line can
  mix reasons. Source: `openspec/project.md` "Domain rules" section, and
  confirmed present verbatim in the Abastecimentos export (e.g. "-2 Outro
  motivo, -2 Outro motivo", "-1 Produto danificado").
- **Reconciliation computed today by `finance-service`**: per store/month —
  valor abastecido (restocked value), CMV (COGS), valor da sobra (remaining
  stock value), perda real (real loss, by reason). Source:
  `backend/apps/finance-service/CLAUDE.md`. Not yet validated against an
  operator's manually-closed month (stated as an open gap in that same
  file).

## Explicitly NOT established — do not treat as fact

- Tax regime (Simples Nacional / Lucro Presumido / Lucro Real), ICMS
  treatment, PIS/COFINS treatment.
- Chart of accounts / cost center structure for the company as a whole (the
  `Gestão Financeira Empresarial` file in `graphify-out/converted/` is a
  generic Brazilian small-business bookkeeping **template** from a
  third-party vendor — macrobit.com.br — with placeholder client/supplier
  names; it is not Agiliz.AI's own chart of accounts or financial data and
  must not be cited as such).
- Full store count, store list, or store-by-store CAPEX history.
- Cost of capital / hurdle rate for ROIC comparisons.
- Minimum liquidity threshold / target cash reserve.
- Supplier terms, payment days, or concentration.
- Location/condominium commission structure (rate, fixed vs. percentage).
- Payment processor fee schedule.
- Historical financial statements (P&L, balance sheet, cash flow) at the
  company level.
- Store-level fixed operating costs (labor, electricity, connectivity,
  software allocation, maintenance) — see
  `.claude/skills/autonomous-retail-cfo/references/store-unit-economics.md`
  for exactly which P&L lines these are and why they matter.

## How to use this file

Before answering a financial question with a company-specific number not
listed above as established, ask the human for it or bound the answer with
scenario analysis
(`.claude/skills/autonomous-retail-cfo/references/scenario-analysis.md`) —
do not fabricate it. When new facts are established, add them here (or to a
new file under `.fpa/sources/` if they come with a document), and add an
entry to `MEMORY.md`.
