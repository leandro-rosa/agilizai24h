## 1. Payment fees (treasury-service)

- [x] 1.1 Validate fee registration: rate within 0–100%, method in the existing vocabulary, acquirer non-empty; reject with a validation error and store nothing
- [x] 1.2 Add a read for the rate in force on a date per (acquirer, method), returning an explicit "no rate" and never 0
- [x] 1.3 Expose the new read through the gateway next to the existing `GET/POST /treasury/fees`
- [x] 1.4 Unit tests: effective-date selection, past-month reads, invalid input, missing rate
- [x] 1.6 Add `fixed_cents` to `AcquirerFee` (additive migration, default 0), accept it on registration with validation, return it from the in-force read
- [x] 1.5 Prepare the proposed seed rates (PagBank pix/debit/credit, the second debit/credit condition, each voucher brand) as a reviewable list for the owner; register only what the owner confirms

## 2. Sales aggregate (sales-service)

- [x] 2.1 Add an aggregate of sales by payment method, acquirer and card brand for a store or the network over a period, with transaction counts
- [x] 2.2 Expose it through the gateway
- [x] 2.3 Tests with fixtures: voucher share differs by store; brand shares; empty period returns "no data", not zeros

## 3. Voucher and payment-cost derivation

- [x] 3.1 Implement the effective voucher fee: weighted by brand share when voucher volume reaches the configured minimum, simple average otherwise, with the method label and the lower-confidence flag
- [x] 3.2 Report a brand with sales but no registered rate as missing, never as 0%
- [x] 3.3 Implement the mix-weighted payment cost over the lookback window per store or network
- [x] 3.5 Brand aliases (Sodexo = Pluxee) as a pricing parameter, applied before matching sales brands to registered fees
- [x] 3.6 Fixed fee per sale: weight by brand, spread over the units sold by receipt-line share, add to the unit cost without multiplying it by loss
- [x] 3.4 Unit tests for the spec scenarios (weighted, simple fallback, missing brand, mix weighting)

## 4. Pricing parameters (intelligence-service)

- [x] 4.1 Add Prisma tables and migration for versioned pricing parameters (target, minimum, per-category overrides, rounding, psychological price, minimum units, minimum confidence, tax rate, volume thresholds, lookback window)
- [x] 4.2 Read/write with version history, mirroring `modules/parameters`; initial target 35% labelled as the owner's reference; tax rate unset until the owner sets it
- [x] 4.3 Tests: new version on change, previous still readable, category override wins

## 5. Source clients (intelligence-service)

- [x] 5.1 Read clients for products (cost and price versions, category, supplier), sales aggregate, finance (valued loss) and accounting (operating share of revenue), following `modules/sources`
- [x] 5.2 Confirm `no-writes.spec.ts` still passes and covers the new clients
- [ ] 5.3 Decide from real data whether the product `CostVersion` history is enough for cost quality; add a per-SKU purchase cost read in suppliers-service only if it is not

## 6. Pricing engine (intelligence-service `modules/pricing`)

- [x] 6.1 Pure function: typed input to minimum, target and recommended price, cost structure, margins, reasons, status
- [x] 6.2 Loss selection product → category → store with minimum units, returning the level used
- [x] 6.3 Operating allocation read, de-duplicated, with the required analysis-only statement; no write path
- [x] 6.4 Rounding and psychological-price rules; ceiling on a single price move; hold-back when volume fell after a past change
- [x] 6.5 Confidence rubric (`high | medium | low | insufficient_data`), including the simple-average voucher penalty
- [x] 6.6 `insufficient_data` for missing, stale or unreliable cost, and when the tax rate is unset; no recommended price
- [x] 6.7 Impact in R$/month labelled as estimated, and margin in R$/month per product
- [x] 6.8 Hand-computed fixture tests for every spec scenario (including the two-products-different-loss and volume-ranking cases); record engine and parameter version on each result

## 7. Reads and runs

- [ ] 7.1 Single-product read computed in the request; catalogue-wide run via the existing queue pattern, stored with engine and parameter versions
- [x] 7.2 Gateway read routes for results and parameters; no price write anywhere
- [x] 7.3 Add `CLAUDE.md` sections for the pricing module and the fee endpoints; set `WITH_KAFKA_BROKERS=false` in any new test setup

## 8. Verification

- [x] 8.1 Run `pnpm turbo run lint typecheck` and the affected services' tests
- [ ] 8.4 Register the confirmed fees (PagSeguro pix/debit/credit; Pluxee 6,90%, Ticket 5,99% + R$ 0,89, VR Benefícios 6,85%, Alelo 6,9%) and the 7,07% tax rate once the owner gives the effective dates and authorises writing to the dev database
- [ ] 8.2 Run the engine on real data (read-only) for one store and one month and review the report with the owner before building the screen; confirm no price version was created in products-service
- [x] 8.3 Confirm the Smart Supply engine's tests and parameter version are unchanged
