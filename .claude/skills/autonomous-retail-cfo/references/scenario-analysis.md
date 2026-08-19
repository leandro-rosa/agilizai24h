# Scenario Analysis

## When to use three cases

Use Downside / Base / Upside whenever uncertainty is large enough that a
single-point estimate could mislead the decision — essentially any forward-
looking number (a new store's revenue, a pricing change's volume response,
a cash forecast beyond a few weeks). Not needed for a backward-looking
reconciliation of a closed month, where `finance-service` gives facts.

## Sensitive drivers to check first

Revenue, gross margin %, shrinkage rate, location commission, inventory
investment, supplier terms, logistics cost, CAPEX, transactions/day,
average ticket. Identify which one or two of these actually move the
recommendation — that's the point of scenario analysis, not producing three
numbers for their own sake.

## Method

1. Build the base case from the best available facts/estimates, each
   labeled per
   [financial-decision-framework.md](financial-decision-framework.md).
2. For each sensitive driver, ask: "at what value does the recommendation
   flip?" That value is the decision trigger — report it, not just the
   downside scenario's output.
3. Construct downside and upside by moving the 1-2 dominant drivers by a
   stated, justified amount (comparable-store variance, historical volatility
   if known, or an explicit "no historical basis, using a round stress
   value" when there's nothing better) — never move every driver
   simultaneously in the same direction without justification, which
   produces an unrealistically extreme case.
4. Report cash impact and ROI/ROIC/payback for each case, not just revenue/
   margin — a downside case that still shows acceptable ROIC changes the
   risk conversation more than one that only shows lower revenue.

## Decision thresholds are the real output

"Open the store if expected monthly revenue > R$X" or "keep the store if
contribution margin > Y%" is more actionable than three scenario labels.
Compute the threshold whenever the math allows it (see
[financial-decision-framework.md](financial-decision-framework.md)).

## What not to do

- Don't smooth a genuinely lumpy driver (a large quarterly tax payment, a
  seasonal demand spike/dip) into an average — the lump is often the thing
  that matters (see [cash-management.md](cash-management.md)).
- Don't present downside/base/upside as equally likely; state or ask for
  the human's sense of likelihood if it affects the recommendation.
- Don't fabricate a probability distribution from no data — a stress test
  ("what if revenue is 20% below plan") is honest; a fake confidence
  interval is not.
