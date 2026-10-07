## Why

The pricing engine's arithmetic is right, but what it puts in the price is not. It sums every variable and fixed expense of the DRE (except loss) and spreads it over store-sales revenue, so a fixed fee (accountant, pró-labore), a per-visit cost (deslocamento) and the costs of other activities were treated as if they varied with the price of one product: 23,35% of every price. The 35% target was then applied to a margin that already paid for the whole structure, so every product looked below target (Monster: R$ 11,90 sold, R$ 19,10 "target"). The owner decided that the 35% target is a CONTRIBUTION-margin target and that fixed costs belong to the viability of the operation.

## What Changes (Phase A)

- **Every DRE expense is classified by how it behaves**, not by the section it was filed under (`operating.accountBehavior`, a versioned parameter): `percent_of_sales` and `per_transaction` enter the price; `per_visit`, `fixed` and `other_revenue_cost` (coffee break and fruits, by owner decision) stay out; `already_component` (tax, card fees, loss, purchases) can never come in again. An account with no class is listed with its value, period and scope, stays out of the price, and makes the calculation **incomplete**: nothing is shown as validated.
- **Three honest numbers**: the contribution margin (the target applies to it), the contribution per unit in R$, and the estimated result after allocation (complementary, criterion visible, never "net profit").
- **`solveStructure`**: `price = (cost/(1−loss) + fixed payment fee + per-transaction per unit) ÷ (1 − tax − payment % − percent-of-sales − margin)`; a denominator ≤ 0 says the target is not reachable by the formula.
- **Per-transaction cost** is distributed ticket → units (a line of three units weighs three) in whole centavos that add up to the total, never as total ÷ lines read as a cost per unit; its hypothesis is written in the result.
- **Cost bases kept apart**: the historical cost the diagnosis uses, the last RECEIVED purchase (with or without an invoice), the cadastral or manual cost in force (never labelled a purchase) and, only in the simulator, an optional replacement quote. `POST /costs/bulk` accepts `sources`.
- **Reconciliation with the previous model**, per product: old margin → new margin, one line per class that moved, and "not explained" (zero when everything is accounted for).

## Out of scope (next phases, by the owner's order)

Market-reference ceiling ("meta não atingida dentro do teto informado"), volume scenarios and the maximum tolerable volume drop, and the break-even of the operation using the contribution of the other revenues.

## Capabilities

### New Capabilities
- `pricing-contribution-margin`: classification of the operating costs, the contribution margin as the target, the three numbers, the cost bases and the reconciliation.

## Impact

- `backend/apps/intelligence-service` (`modules/pricing`): `operating-costs.ts` (replaces `operating-share.ts`), `transaction-cost.ts`, `price.ts`, `new-product.ts`, `simulate.ts`, `pricing.parameters.ts`, `pricing.service.ts`; engine `pricing-4`.
- `backend/apps/products-service`: optional `sources` on `POST /costs/bulk`.
- `frontend/apps/admin`: wording and columns (contribution margin), the incomplete-calculation alert, the cost bases and the reconciliation in the product detail, the class of each account in the rules, the replacement quote in the simulator, Excel and PDF headers.
