## Context

See proposal.md for motivation. Current state that shapes the approach:

- `treasury-service` already has `AcquirerFee` (`acquirer`, `payment_method`, `rate_bps`, `effective_from`, unique on the three) and `GET/POST /treasury/fees` through the gateway. No rate is registered anywhere, and nothing validates input.
- `sales-service` records `method`, `acquirer` and `card_brand` per transaction but exposes only transactions, not an aggregate by method/brand.
- `products-service` owns dated `CostVersion`/`PriceVersion`; markup and margin are derived on purpose. `suppliers-service` has `PurchaseItem.unit_cost_cents` per purchase but no per-SKU cost history endpoint.
- `finance-service` owns valued loss and CMV per store/month; `accounting-service` owns DRE, fixed expense and travel (allocated by visit count). Neither is to be re-derived.
- `intelligence-service` already provides versioned parameters (`modules/parameters`), read-only source clients (`modules/sources`) guarded by `no-writes.spec.ts`, and an engine that is pure and deterministic. Rules that shape recommendations live in the backend, never the browser.
- The tax rate (about 7.07% historically) exists only as a ledger account, not as a parameter.

## Goals / Non-Goals

**Goals:**
- A pure pricing function over a typed input, so every result is reproducible from stored inputs and parameter version.
- Fees registered once, in `treasury-service`, and read by the engine; nothing duplicated.
- Honest uncertainty: labelled fallbacks, lower confidence, and no recommendation when cost is not trustworthy.

**Non-Goals:**
- No screen, no export, no applying a price, no decision history (later changes).
- No change to the Smart Supply engine or its parameters.
- No new financial entry and no re-derivation of CMV, loss or DRE.
- No demand-elasticity model. The recommendation reads recent volume as a risk signal only.

## Decisions

**1. Engine lives in `intelligence-service/src/modules/pricing/`, isolated from `engine/`.** Confirmed by the owner. It reuses the source-client pattern and the no-writes guard, and gets its own parameter table so a pricing change never bumps the mix parameter version. Alternative: a new `pricing-service`. Rejected for now: it would add a service, a database and a queue for a read-mostly computation that needs the same source clients.

**2. Fees stay in `AcquirerFee`; no schema change.** Voucher brands are `acquirer` values under `voucher`. The second debit/credit condition the owner mentioned (1.89% and 3.50% next to 1.39% and 2.97%) is registered as a distinct acquirer label, and the engine weights by the `(acquirer, method)` share observed in sales. Alternative: add a `condition` column to the key. Rejected: sales already carry `acquirer`, so a label is enough, and a column would touch a table that works. If a sales `acquirer` string has no registered match, it is reported as missing a rate, never as 0%.

**2a. Fixed fee per sale becomes a column; rate per brand is the highest active one; aliases are configuration.** Decided by the owner on 2026-10-06 after the real sales were read: voucher is about 25% of revenue and the average receipt is about R$ 9–10, so Ticket's R$ 0,89 per sale is roughly a tenth of the ticket and cannot be left out. `AcquirerFee` gains `fixed_cents` (additive migration, default 0). Sales do not say PAT versus Auxílio, so each brand is registered at its highest active rate (Pluxee 6,90%, Ticket 5,99% + R$ 0,89, VR Benefícios 6,85%, Alelo 6,9%) and the averaging across brands is done by the engine; this is prudent, not measured, and is labelled so. Sodexo (the name sales use, about half of the voucher volume) is Pluxee: a `payment.brandAliases` pricing parameter, not a code constant. The fixed fee is spread over the units sold using the share of receipt lines, and is not multiplied by loss because lost units are never sold. Alternatives: one row per condition weighted by an unknown mix (rejected: nothing measures it), a percentage-equivalent of the fixed fee using the average ticket (rejected: it hides a per-sale cost that varies with price).

**2b. Debit/credit plans are averaged when sales cannot tell them apart.** The owner registers the second condition (1,89% debit, 3,50% credit) as another acquirer, and sales only say PagSeguro, which is PagBank. With one acquirer in the sales for a method, the engine uses the simple average of the registered rates of that method and says so in the result; with several acquirers, each uses its own. Alternatives: keep plan 1 and only warn (rejected by the owner), take the highest (rejected by the owner).

**3. Fee API gets validation and an "in force" read.** Rate in `[0, 10000]` bps, method in the existing vocabulary, a read that returns the latest rate on or before a date per `(acquirer, method)` and an explicit "no rate". Seed values are proposed to the owner and registered only after confirmation; they are not code constants.

**4. Voucher fee = average over brands.** Weighted by brand share of voucher sales in the lookback window when voucher sales reach a configurable minimum count; otherwise the simple average, flagged. The share of voucher in total sales comes from the same sales aggregate. Alternative: a single flat voucher rate. Rejected by the owner's instruction.

**5. Payment cost is a mix-weighted rate.** `sum(share(acquirer, method) × rate_in_force)` over the lookback window, per store or network. Never a fee applied to all sales.

**6. Price is solved from a cost structure, not from a markup.** Variable costs as a fraction of price: tax + weighted payment fee + loss-adjusted cost. Price solves `price × (1 − tax − fee − operating_share) − cost × (1 + loss_factor) = margin × price`, with the operating allocation as a share of revenue read from accounting. Minimum uses the minimum margin, target the target margin. Recommended starts at the target, is adjusted by rounding and psychological price rules, and is held back or flagged when recent volume fell after a past price change or when the move exceeds a configurable ceiling. The formulas are pure and unit-tested against hand-computed fixtures.

**7. Operating allocation is read, labelled, and de-duplicated.** Taken from `accounting-service` as a share of revenue over the window, excluding anything already carried by another component (e.g. travel already in CMV-side allocation). The statement "Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro." is part of the result. The engine has no write path to accounting.

**8. Loss prefers product, then category, then store.** Product-level only above a minimum number of units, to avoid a 100% loss from one unit. The level used is returned.

**9. Confidence is a small explicit rubric**, not a score pretending to precision: cost quality (recent, from a purchase), units sold, cost stability, data completeness, loss history, and fee derivation (simple average lowers it). Output is one of `high | medium | low | insufficient_data`.

**10. Parameters are versioned in the engine's own tables** (target, minimum, per-category overrides, rounding, psychological price, minimum units, minimum confidence, tax rate, volume thresholds), mirroring `intelligence-parameters`. The target starts at 35% labelled as the owner's reference. Fee and loss values are not duplicated here.

**11. Reads through the gateway only; computation through a queue for the full catalogue.** A single product can be computed in the request because it is pure arithmetic over fetched inputs; a catalogue-wide run follows the existing run/queue pattern and is stored with engine and parameter versions.

## Risks / Trade-offs

- [Receipt lines are used as the count of sales, but a coupon can hold several lines] → Overstates the per-sale fee slightly when baskets have several items; documented, and the average line is about R$ 9–10 so most coupons are one line.
- [Highest-rate-per-brand overstates the voucher cost] → Intentional prudence chosen by the owner; labelled as an assumption, and a measured PAT/Auxílio split can replace it later without changing the engine.
- [Sales `acquirer`/`card_brand` strings may not match registered names] → An alias check at registration time and an explicit "missing rate" result; weights never fall back silently to zero.
- [Tax rate has no source today] → The engine refuses to recommend when it is unset, rather than assuming 7.07%; the owner confirms it as a parameter.
- [Operating allocation may overlap with CMV or loss] → One documented list of what each component includes, a test that shows an expense once, and the owner reviews the first real report before trusting it.
- [Per-SKU purchase cost history is missing] → Cost quality uses the product's `CostVersion` history first; a read of purchase items is added only if that is not enough.
- [Recommendation over-reaches on thin data] → Minimum units, minimum confidence, a ceiling on a single price move and low confidence on fallbacks.
- [Large catalogue × stores is O(N×M)] → Queue per store, like the mix engine.

## Migration Plan

Additive only. New tables in `intelligence-service`; new read routes in the gateway; fee validation tightens an existing write but accepts all valid current data (none exists). Rollback is removing the module and routes; no data in other services changes.

## Open Questions

- Effective dates of every fee, and which acquirer label carries the second debit/credit condition (owner to confirm; engine does not depend on the values). Note that sales report the acquirer as `PagSeguro`, so PIX/debit/credit fees must be registered under that name to be matched.
- Lookback window for the payment mix and loss (default proposed: last 3 closed months).
