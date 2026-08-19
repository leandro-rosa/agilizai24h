# Financial Decision Framework

Every consequential financial recommendation (store open/close/renegotiate,
CAPEX, supplier switch, pricing change, inventory reallocation) follows this
structure. Skip stages only when they're genuinely inapplicable (e.g. no
CAPEX in a pricing decision) — never skip them for brevity.

```
OBSERVATION      what changed or what's being asked
↓
EVIDENCE         the facts underneath the observation, with source
↓
FINANCIAL IMPACT quantified, in the right unit (R$, %, days)
↓
ROOT CAUSE       why, not just what
↓
OPTIONS          at least two, including "do nothing"
↓
BASE/UPSIDE/DOWNSIDE   see scenario-analysis.md
↓
CASH IMPACT      distinct from accounting profit — see cash-management.md
↓
ROI/ROIC/PAYBACK when capital is involved
↓
RISKS            what could make the recommendation wrong
↓
RECOMMENDATION   one clear call, or an explicit "insufficient evidence"
↓
DECISION TRIGGER the number that would flip the recommendation
↓
CONFIDENCE       high/medium/low, and why
```

## Evidence typing — never blur these four

| Type | Definition | Example |
|---|---|---|
| **FACT** | Read from a system of record or a document the human supplied | "Store 12's April CMV was R$8,340" (from `finance-service`) |
| **DERIVED METRIC** | Computed from facts by a stated formula | "Gross margin 34%" (= gross profit / net revenue, both facts) |
| **ASSUMPTION** | An unstated input taken as given because it's not yet known | "Assuming the R$1,200 commission stays flat next quarter" |
| **ESTIMATE** | An assumption expressed as a number, usually because no fact exists yet | "Estimated monthly revenue for a not-yet-opened store: R$38,000" |

Label every number in a recommendation with one of these four tags (inline
or in a short "Basis" line) when the distinction matters to the decision.
Never let an estimate read like a fact — that's the single most common way a
retail financial recommendation goes wrong.

## When information is missing

1. Identify exactly which variable is missing.
2. Determine whether it actually changes the decision (run the decision at
   plausible extremes — if the call doesn't flip, the gap doesn't block).
3. If it does change the decision, use scenario analysis
   ([scenario-analysis.md](scenario-analysis.md)) rather than stalling.
4. Label every assumption used to fill the gap, explicitly, in the output.
5. Never fabricate a company-specific actual (a real month's revenue, a real
   supplier price) to fill a gap — ask, or bound it with a scenario.

## Decision thresholds beat generic recommendations

Prefer "keep the store if contribution margin > 12%" over "the store looks
okay." A threshold is falsifiable against next month's actual and tells the
operator exactly what to watch. Compute it whenever the decision is
sensitive to one or two dominant variables (see
[scenario-analysis.md](scenario-analysis.md) for how to find them).

## Provenance

Where the analysis draws on company data rather than the conversation alone,
record source, period, entity (store/region/company), currency, extraction
date, the calculation used, and confidence — see `.fpa/sources/` and
`.fpa/assumptions/` for where this is persisted durably across sessions.
