---
name: fpa-memory-index
description: Index of Agiliz.AI's durable company financial memory — read this first for any financial question needing prior context.
metadata:
  type: index
---

# Company Financial Memory — Index

Durable, company-specific financial facts, assumptions, corrections,
forecasts, and decisions for Agiliz.AI. Read by
[`.claude/skills/autonomous-retail-cfo`](../.claude/skills/autonomous-retail-cfo/SKILL.md).
Structure follows [OpenFPA](https://github.com/JeffBrines/openfpa)'s
company-workspace layout as an architectural reference (see
[docs/financial-ai-architecture.md](../docs/financial-ai-architecture.md)
for why it wasn't vendored as a runtime dependency) — kept here as plain
Markdown/YAML, no Python kernel required.

## Status

Mostly structure-only, with one recorded decision (see Entries). See
`business-profile.md` for what's still missing before other company facts
can be cited.

## Directories

- `sources/` — raw evidence (documents, exports) and their provenance:
  source, period, entity, currency, extraction date, confidence.
- `mappings/` — how source data maps to the retail-finance model in
  `.claude/skills/autonomous-retail-cfo/references/`.
- `assumptions/` — standing assumptions used across analyses (e.g. a cost
  of capital, a minimum liquidity threshold) until a fact supersedes them.
- `corrections/` — human corrections to prior Claude analysis, with the
  reason, so the same mistake isn't repeated.
- `forecasts/` — saved forecasts, with the assumptions and date they were
  built, so actual-vs-forecast can be checked later.
- `decisions/` — recorded financial decisions (open/close/renegotiate/
  pricing/supplier), with the recommendation, the human's actual call, and
  the outcome once known.
- `models/` — versioned financial models, when one exists (e.g. a network
  3-statement model built via the `financial-analysis` plugin).
- `research/` — exploratory analysis that didn't rise to a decision or a
  standing assumption.

## Entries

- [Business Profile](business-profile.md) — what's established about
  Agiliz.AI vs. what's still missing; read before citing any company fact.

- [Inventory adjustment valuation](decisions/inventory-adjustment-valuation.md) —
  `Diferença` (inter-store stock movement) is valued at current cost in the
  current period, never traced to an origin store; resolves D6 of
  `align-ingestion-with-real-reports`

<!-- add one line per new fact/decision/assumption file, in this format:
     - [Title](path/to/file.md) — one-line hook, newest relevant first -->
