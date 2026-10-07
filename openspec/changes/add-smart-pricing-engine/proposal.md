## Why

The owner has no way to answer "is my price right, and what should I charge?" with the real cost of operating. Price, cost, losses, payment fees, taxes and operating expense each live in a different service, and the margin people see is only `(price - cost) / price`. The Smart Pricing screen needs a decision layer over those sources, and that layer needs two things that do not exist yet: payment fees actually registered per acquirer and card brand, and a versioned margin/tax/rounding policy that lives in the backend.

## What Changes

- **Payment fees become registered data.** The owner registers rates per acquirer and method (PagBank pix/debit/credit; Pluxee, Ticket, VR Benefícios, Alelo as voucher brands) with an effective date. Nothing is hard-coded; the 0.69% / 1.39% / 2.97% / 1.89% / 3.50% references from the owner are seed input to confirm, not constants.
- **A pricing engine, isolated in `intelligence-service` (`modules/pricing`).** It does not touch the mix/restock engine. For each product (optionally per store) it computes minimum, target and recommended price from: acquisition cost, tax rate, loss rate, weighted payment fee, voucher share and an operating allocation, then returns the reasons and a confidence level. Pure and deterministic, so a result can be reproduced from its inputs.
- **Effective voucher fee = average across brands.** Weighted by each brand's real share of voucher sales (`card_brand` in sales) when volume is enough; simple average otherwise, labelled as such and with lower confidence. The voucher share of sales (about 22% today) is read from sales, never fixed.
- **Versioned pricing parameters** (target margin, minimum margin, per-category overrides, rounding, psychological price, minimum sales quantity, minimum confidence, tax rate), following the existing `intelligence-parameters` pattern. Financial rates are not duplicated here; they stay with their owning services.
- **Products without a trustworthy cost get no recommendation** and are reported as insufficient data.
- **No UI in this change.** The screen at `/purchases/pricing`, the drawer/simulator, applying a price and Excel/PDF export come in later changes.

## Capabilities

### New Capabilities
- `payment-fees`: registering and reading acquirer/brand fees by payment method with effective dates, and deriving the effective voucher fee (weighted by brand share, simple average as fallback).
- `pricing-engine`: the price computation (three prices, cost structure, loss/tax/fee/voucher/operating components, reasons, confidence, insufficient-data rule) and its versioned parameters.

### Modified Capabilities
<!-- None. `treasury` has no fee requirements today; `payment-fees` is introduced as its own capability. -->

## Impact

- `backend/apps/treasury-service`: fee write/read endpoints already exist (`GET/POST /treasury/fees`); this change adds validation, an effective-rate read, and the brand-aware derivation. A second debit/credit condition per acquirer needs a decision on the `(acquirer, payment_method, effective_from)` unique key (see design).
- `backend/apps/intelligence-service`: new `src/modules/pricing/` (engine, parameters, source clients) and Prisma tables for pricing parameter versions. New read clients for products (cost, price), sales (method/brand mix), finance (loss) and accounting (operating allocation); the existing no-writes guard keeps applying.
- `backend/apps/gateway-service`: read routes for the engine. No price write here.
- `backend/apps/sales-service`: an aggregate of sales by payment method and brand is needed (today only transactions are exposed).
- `backend/apps/suppliers-service`: per-SKU purchase cost history is needed as a cost-quality input.
- Not affected: the Smart Supply (Abastecimento Inteligente) engine, `products-service` price writes, the DRE and the finance-service numbers (read, never re-derived).
