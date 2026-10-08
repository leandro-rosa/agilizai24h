## 1. Registry (products-service)

- [x] 1.1 `sources` on `POST /costs/bulk` (the last received purchase), with a test

## 2. Engine (intelligence-service)

- [x] 2.1 Classification of every DRE expense (`operating.accountBehavior`, locked components, unclassified listing, relevance)
- [x] 2.2 `solveStructure` with percentages in the denominator and per-transaction money in the numerator, unreachable target
- [x] 2.3 Ticket → unit distribution of the per-transaction cost, exact in centavos, with its hypothesis
- [x] 2.4 Contribution margin, contribution per unit, result after allocation, validation flag
- [x] 2.5 Cost bases (historical, last received purchase, cadastral or manual) and the current suggestion; replacement quote in the simulator
- [x] 2.6 Reconciliation with the previous model; engine `pricing-4`

## 3. Admin

- [x] 3.1 Contribution-margin wording, the three numbers, the incomplete-calculation alert, the cost bases and the reconciliation
- [x] 3.2 Class of each account in the rules, replacement quote in the simulator, Excel and PDF headers

## 3b. Review round (fixed fee per unit, travel, preserved reports)

- [x] 3b.1 Fixed payment fee per UNIT from tickets and units (sales-service reports `units`, `tickets`, `lines_without_coupon`); exact ticket distribution and the approximation named
- [x] 3b.2 Average travel cost per restocking from the monthly spend and the restocking visits (supply-service `GET /visits/counts`), outside the price
- [x] 3b.3 Run history and a run's report as it was computed; the report keeps its original metric name and definition
- [x] 3b.4 A received line with zero units creates no cost (`skipped_not_received`)

## 4. Verification

- [x] 4.1 Unit tests for every item, typecheck, lint, comparison old × new over the stored September report

## 5. Pending (next phases, owner's order)

- [ ] 5.1 Market-reference ceiling and "meta não atingida dentro do teto informado"
- [ ] 5.2 Volume scenarios and the maximum tolerable drop
- [ ] 5.3 Break-even using the contribution of the other revenues
