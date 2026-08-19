# Pricing and Margin

## What a pricing analysis must consider

Price, Volume, Gross Margin, Contribution Margin, Elasticity assumptions,
Shrinkage, Payment fees, Taxes (when known), Competitive constraints (host
company/condominium context, nearby alternatives).

## Never fabricate elasticity

There is no elasticity data established for this business yet. Do not
invent a price-elasticity coefficient. If the human hasn't supplied one and
none exists in `.fpa/assumptions/`, run a sensitivity table instead of a
point estimate.

## Sensitivity table pattern

```
Price change:      +1%      +2%      +3%
Volume change:       0%      -1%      -2%      -3%
```

For each price/volume pair, compute resulting Net Revenue and Contribution
(R$), not just margin %. A price increase can raise margin % while lowering
total contribution if volume drops enough — always show the R$ outcome
alongside the %.

## Break-even volume drop

For a given price increase, compute the volume decline that would leave
contribution unchanged — this is a decision threshold
([financial-decision-framework.md](financial-decision-framework.md)): "this
price increase is worth it unless volume falls more than X%." State it even
when elasticity is unknown; it reframes an unanswerable "will demand hold?"
into an answerable "is a >X% volume drop plausible for this SKU/category?"

## Payment fees and shrinkage as pricing inputs

Card/PIX processor fees and expected shrinkage on a SKU are real costs that
belong in the contribution calculation behind a pricing decision, not just
in the store-level P&L — a low-price, high-fee-percentage, high-shrinkage
SKU (e.g. small high-theft-risk items) can have much worse unit economics
than its sticker margin suggests.

## Taxes

Do not assume a specific tax treatment (ICMS, PIS/COFINS, tax regime) affects
a given SKU's margin without evidence — see
[financial-governance.md](financial-governance.md). Flag pricing decisions
that hinge materially on tax treatment for accountant/controller review.
