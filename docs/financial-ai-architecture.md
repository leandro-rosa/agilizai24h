# Financial AI Architecture

How Claude acts as financial decision support (CFO + FP&A + Retail Finance +
Treasury + Inventory Finance + Capital Allocation Advisor) for Agiliz.AI.
Full domain knowledge lives in
[`.claude/skills/autonomous-retail-cfo/`](../.claude/skills/autonomous-retail-cfo/SKILL.md)
— this document is the map, not a duplicate of that content.

## Layered architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Human — approves consequential decisions                    │
├─────────────────────────────────────────────────────────────┤
│ .claude/skills/autonomous-retail-cfo/  (this project's       │
│   authoritative financial domain skill — retail unit         │
│   economics, KPIs, decision framework, templates, scripts)  │
├───────────────┬───────────────────────┬─────────────────────┤
│ financial-     │ fund-admin plugin      │ charlie skill        │
│ analysis       │ (claude-for-financial- │ (everyinc/charlie-   │
│ plugin         │ services) — GL recon,  │ cfo-skill) — generic │
│ (claude-for-   │ break-trace, accruals, │ cash-discipline      │
│ financial-     │ roll-forward, variance │ mental models only;  │
│ services) —    │ commentary             │ SaaS benchmarks      │
│ 3-statement    │                        │ fenced off, see      │
│ model, model   │                        │ financial-           │
│ audit          │                        │ governance.md        │
├───────────────┴───────────────────────┴─────────────────────┤
│ .fpa/  — durable company financial memory (facts,             │
│   assumptions, corrections, forecasts, decisions, models,     │
│   research), currently structure-only                        │
├─────────────────────────────────────────────────────────────┤
│ backend/apps/finance-service — the SYSTEM OF RECORD for       │
│   the four reconciliation facts: valor abastecido, CMV,       │
│   valor da sobra, perda real (per store/month)                │
└─────────────────────────────────────────────────────────────┘
```

The skill sits **above** `finance-service`, never re-deriving what it
already computes; it sits **beside** the two installed plugins and the
`charlie` skill, routing each to what it's actually good for.

## Installed

- **Marketplace**: `claude-for-financial-services`
  (`anthropics/financial-services`) — user scope.
- **Plugin**: `financial-analysis@claude-for-financial-services` — project
  scope. Core modeling/audit commands (`3-statement-model`, `debug-model`,
  plus `dcf`/`comps`/`lbo`/`competitive-analysis`/`ppt-template`, which are
  IB/PE-oriented and not the primary retail use case here).
- **Plugin**: `fund-admin@claude-for-financial-services` — project scope.
  Finance-ops skills (`gl-recon`, `break-trace`, `accrual-schedule`,
  `roll-forward`, `variance-commentary`; `nav-tieout` is fund-specific and
  not relevant here) — the closest fit in this marketplace to month-end
  review discipline.
- **Skill**: `charlie` (`everyinc/charlie-cfo-skill@charlie`), installed
  project-locally via `npx skills add` (this repo's existing convention —
  see `skills-lock.json`). Cash-discipline mental models only; its SaaS
  numeric benchmarks are explicitly out of scope for this business — see
  `.claude/skills/autonomous-retail-cfo/references/financial-governance.md`.
- **Skill**: `autonomous-retail-cfo` — custom, project-scoped, this repo's
  authoritative financial domain skill.

### Evaluated and not installed

- **`gl-reconciler` / `month-end-closer`** (agent-plugins in the same
  Anthropic marketplace) are Claude subagent definitions requiring
  `mcp__internal-gl__*` / `mcp__subledger__*` MCP servers — built for an
  environment with a GL/subledger system already wired up via MCP. No such
  MCP servers exist in this repo. `fund-admin`'s standalone skills
  (installed above) provide the same GL-reconciliation and variance-
  commentary capability without that dependency.
- **`investment-banking`, `equity-research`, `private-equity`,
  `wealth-management`, `operations`, `lseg`, `sp-global`** — out of scope
  for an operating retail business per the mission that produced this
  architecture; not installed.
- **OpenFPA** (`JeffBrines/openfpa`) — see below.

## OpenFPA: evaluated, integrated as architecture reference only

OpenFPA is a real, actively maintained project: a Python finance kernel
(`pyfpa`) plus a Claude/Codex agent contract plus a `.fpa/` company-memory
layout, distributed as a single-repo Claude plugin (`.claude-plugin/
plugin.json` at its root, not a marketplace) and as individual skills on
`skills.sh`.

**Decision: not installed as a plugin or Python dependency.** Two
independent reasons:

1. **No clean installation path for this CLI.** `claude plugin marketplace
   add` requires a `marketplace.json`; OpenFPA's repo root has a
   `plugin.json` instead (it's designed to be installed as itself, not
   listed in a marketplace), so `claude plugin marketplace add
   JeffBrines/openfpa` fails with "Marketplace file not found."
2. **This repo doesn't need a second finance kernel.** OpenFPA's own
   operating skills (`fpa-cash-runway`, `fpa-monthly-close`, `fpa-excel-
   model`, etc.) hard-depend on the `pyfpa` Python package and an `openfpa`
   CLI (e.g. `openfpa entrypoint-list`, `pyfpa.cash13_forecast(...)`).
   Agiliz.AI already has a tested reconciliation kernel —
   `backend/apps/finance-service` (NestJS/Prisma/Postgres) — computing the
   real per-store/month figures from real ingested data. Installing
   `pyfpa` would add a second language runtime (Python, currently absent
   from this otherwise all-TypeScript monorepo) and a second, redundant
   source of truth for numbers `finance-service` already owns.

What **was** reused, as architecture/content — not code:

- The `.fpa/` company-workspace directory layout (`MEMORY.md`,
  `business-profile.md`, `sources/`, `mappings/`, `assumptions/`,
  `corrections/`, `forecasts/`, `decisions/`, `models/`, `research/`),
  created fresh at the repo root, in plain Markdown/YAML, with no Python
  dependency.
- OpenFPA's "CFO judgment" checklist (pre-close-month traps, flash-vs-GL
  cash, timing artifacts, one-off flags) — adapted into
  `.claude/skills/autonomous-retail-cfo/references/cash-management.md`,
  rewritten against this business's actual completeness signals
  (`finance-service`'s `complete`/`unvalued`/`inconsistent_stock` flags)
  rather than OpenFPA's multi-entity/intercompany framing, which doesn't
  apply here.

If a future need arises for actual driver-based cash-flow modeling code
(not just reasoning), revisit installing `pyfpa` in an isolated virtual
environment at that time — do not add it speculatively.

## Financial memory strategy

`.fpa/` at the repo root, structure-only today (see `.fpa/MEMORY.md` and
`.fpa/business-profile.md` for exactly what's established vs. missing). The
skill is instructed to read `.fpa/MEMORY.md` before answering a question
needing prior context, and to write new facts/decisions there instead of
re-deriving them each session. Distinguishes Known Facts (with source),
Assumptions, Human Corrections, Decisions, Model Versions, and Source
Evidence per directory.

## Data-source strategy

`finance-service` is the system of record for the four core reconciliation
figures; everything below Gross Profit in the store P&L (fees, commission,
logistics, labor, energy, software, corporate allocation) is not yet
computed by any backend service and must come from the human or from a
document, labeled per the evidence-typing rule below. Two real documents
already in the repo (`graphify-out/converted/`) were evaluated during setup:
an Ascenty-client operations export (real evidence, cited in
`.fpa/business-profile.md`) and a generic third-party bookkeeping template
(explicitly flagged as *not* company data — see the same file).

## Decision framework

Every consequential recommendation follows OBSERVATION → EVIDENCE →
FINANCIAL IMPACT → ROOT CAUSE → OPTIONS → BASE/UPSIDE/DOWNSIDE → CASH IMPACT
→ ROI/ROIC/PAYBACK → RISKS → RECOMMENDATION → DECISION TRIGGER → CONFIDENCE,
with every number tagged FACT / DERIVED METRIC / ASSUMPTION / ESTIMATE. Full
detail:
`.claude/skills/autonomous-retail-cfo/references/financial-decision-framework.md`.

## Governance

Claude produces analysis and recommendations only — it never executes
transfers, changes supplier payments, posts accounting entries, approves
budgets, opens/closes stores, signs contracts, changes production prices,
creates debt, or makes tax elections. Full detail:
`.claude/skills/autonomous-retail-cfo/references/financial-governance.md`.

## Extending this

- New retail-finance domain knowledge → add a reference under
  `.claude/skills/autonomous-retail-cfo/references/`, link it from
  `SKILL.md`'s routing table. Keep `SKILL.md` itself short.
- A new recurring output shape → add a template under
  `.claude/skills/autonomous-retail-cfo/templates/`.
- A new non-trivial deterministic calculation → add a tested function to
  `.claude/skills/autonomous-retail-cfo/scripts/retail_finance.py`
  (Decimal, not float; see the existing functions and
  `test_retail_finance.py` for the pattern). Run
  `python3 -m unittest test_retail_finance` from that directory before
  committing a change.
- A new company fact, assumption, correction, forecast, or decision → file
  it under the matching `.fpa/` subdirectory and index it in
  `.fpa/MEMORY.md`.
