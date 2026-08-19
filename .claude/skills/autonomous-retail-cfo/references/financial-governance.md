# Financial Governance

## Claude provides decision support only

This skill, and every financial tool installed alongside it, produce
analysis and recommendations. None of them execute consequential actions.
Claude must **not** autonomously: execute bank transfers, change supplier
payments, make accounting entries, approve budgets, open or close stores,
sign contracts, modify prices in production, create debt, make investments,
or make tax elections. High-impact financial recommendations require
explicit human review and an execution workflow outside this skill's scope
— never treat a Claude recommendation as itself the approval.

## What the other installed financial tools are for, here

| Tool | What it is | Use it for | Don't use it for |
|---|---|---|---|
| `financial-analysis` plugin (`claude-for-financial-services`) | IB/PE-oriented modeling commands: DCF, comps, LBO, 3-statement models, competitive analysis, deck QC | `3-statement-model` and `debug-model` for building/auditing a network-level 3-statement model or spreadsheet, once one exists | `comps`, `lbo`, `ppt-template` — built for deal work, not an operating retail business; don't force a retail decision through an M&A lens |
| `fund-admin` plugin (`claude-for-financial-services`) | Finance-ops skills: GL reconciliation, break tracing, accruals, roll-forwards, variance commentary | `gl-recon`, `break-trace`, `variance-commentary`, `roll-forward`, `accrual-schedule` for month-end review process discipline, once a GL/ledger export exists | `nav-tieout` — fund/NAV specific, not applicable here |
| `charlie` skill (`everyinc/charlie-cfo-skill`) | Cash-discipline mental models for **bootstrapped SaaS/startups** | Generic capital-discipline framing: runway thinking, driver-based planning, reserve structuring, review rhythms | **Never** its numeric benchmarks as-is: LTV:CAC, CAC payback, MRR/ARR/NRR, Rule of 40, revenue-per-employee-at-ARR bands, SaaS cash-conversion-cycle targets, SaaS spending-as-%-of-ARR. None of these map to an unattended micro-market network; treat every number in `charlie`'s SKILL.md as a SaaS-context example, not a target, unless the human explicitly validates an analogous retail benchmark with a cited source |
| This skill (`autonomous-retail-cfo`) | Retail/grocery-specific unit economics, KPIs, and decision frameworks | The default for any Agiliz.AI financial question | — |

OpenFPA (`JeffBrines/openfpa`) was evaluated and **not installed** as a
plugin or Python dependency — see `docs/financial-ai-architecture.md` for
why. Its `.fpa/` company-memory layout and its "CFO judgment" checklist were
adapted as architecture/content references (this skill's
[cash-management.md](cash-management.md) judgment-checks section and the
`.fpa/` directory at the repo root), not vendored as code.

## Evidence rules

- Never invent company numbers or fake actuals — see
  [financial-decision-framework.md](financial-decision-framework.md).
- Company historical evidence (from `finance-service`, from a document the
  human supplies, from `.fpa/`) outweighs generic or cross-industry
  benchmarks, always.
- An external benchmark used in an analysis needs a stated source and
  context for why it's a reasonable comparison for this business — an
  unsourced number is an unlabeled assumption.

## Brazil-specific guardrails

Currency is BRL by default. Do not assume a tax regime (Simples Nacional,
Lucro Presumido, Lucro Real), ICMS treatment, PIS/COFINS treatment, or
specific tax credits without evidence in the repo or from the user. Flag any
recommendation whose conclusion depends materially on a tax/accounting
treatment for accountant/controller validation before it's acted on.
