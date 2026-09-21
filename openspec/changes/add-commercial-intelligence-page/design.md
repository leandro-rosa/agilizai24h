## Context

See `proposal.md` — Why / What Changes for motivation and scope; `specs/commercial-intelligence/spec.md` for the behavior contract. This document is the durable home for the analytic rules and thresholds, which the spec deliberately does not enumerate.

What the approach builds on, verified against the running stack and the code (2026-09-19):

- **Sales transactions** (`SalesTransaction`, `GET /sales/:storeId/transactions?period=`): one row per sold line with `occurred_at`, `sku`, `quantity`, `amount_paid_cents`, `original_amount_cents`, `discount_cents`, `coupon`, `result`, `buyer_number`, POS/terminal fields. Only for stores/periods ingested from the network-wide format (Aug/2026 onward); older months return 404, which the admin maps to "no data". ~11,000 rows per network-month across ~24 stores. Only `result === "OK"` counts. Grouping by `${store_id}:${coupon}` reconstructs a purchase (`groupBaskets`).
- **Costs and prices** (`products-service`): dated `cost_version` covers all 233 SKUs; `price_version` has one row, so list price is not usable as the price source. There is no "current cost", only cost as of a date; the admin convention is `asOf: "${period}-01"`.
- **Loss** (`finance-service` reconciliation via `GET /finance/:storeId`): monthly, per store × SKU × reason, in cents, valued at cost. Reasons that count as loss: `expired`, `damaged_product`, `other_reason`. Operators use `other_reason` for suspected theft but no reliable classification exists. All 24 store-months of Jul and Aug/2026 have `complete = false` because of `inconsistent_stock`.
- **Supply** (`supply-service`): monthly restocked units per store × SKU, giving sell-through (sold ÷ restocked). No visit dates, no daily stock.
- **Catalog**: `category` ∈ meal | snack | beverage | essential; 156 snack, 53 beverage, 23 essential, **1 meal**; the ~22 marmita/strogonoff/frango SKUs are `snack`. `subcategory` and `shelf_life_days` are null for all 233 SKUs.
- **Timestamps**: `occurred_at` is the store's local wall-clock time stored as if it were UTC (`Date.UTC(1899,11,30)+serial` in ingestion). Reading it with browser-local `getHours()` shifts it by the viewer's offset.
- **Existing pure modules** (`sales-insights.ts`, `loss-insights.ts`) are uncommitted work in the tree this page builds on. Two findings about them drive decisions D5 and D7 below.
- **Gateway**: `sales:read` gates the transactions route, but products, finance, supply and stores each need their own `*:read`. Per-call upstream timeout is 3 s.

## Goals / Non-Goals

**Goals:**
- Every number and recommendation on the page is derivable from data the admin already fetches, with its evidence shown and its confidence computed from a documented rubric.
- The engine is a set of pure functions with no framework imports, so it can be unit-tested when a test runner exists and exercised today with a throwaway script.
- The page degrades block by block and is honest about everything it cannot know.

**Non-Goals:**
- Any backend change (endpoint, service, migration, queue) or new npm dependency **in this change**. The business rules that shape recommendations need the backend, and moving them there is the point of the separate change `add-commercial-intelligence-governance`; until it lands they are read-only deployment defaults (D16), never per-browser settings.
- Fixing `/sales` (margin base defect, browser-local time in the heatmap and store profile). They are recorded here and get their own change.
- Measuring price elasticity, promotion outcomes, cannibalization over time, or any before/during/after comparison (needs persisted experiments and multi-month history).
- Inferring stock-outs, launch dates or shelf-life effects (needs daily stock, launch dates, `shelf_life_days` exposed).
- Fixing the catalog taxonomy (a data task; the engine is category-generic so it improves by itself once fixed).

## Decisions

### D0. Every threshold is a provisional guardrail, calibrated from real data and never tuned to make results appear

The operator (2026-09-19) held the implementation of the analytics until the real months are imported (`add-drive-ingestion-source`) and the quality of `Cupom` and of the history is validated, and asked that analytic rules not be frozen meanwhile. Consequently every threshold in this document is a **provisional default and a guardrail**, not a final rule: it lives in one configuration (D16), is shown as provisional, and is reviewed against the real distribution of Agiliz.ai's data (D23, tasks group 5) before being frozen. The purpose of the calibration is to avoid false signals while not blocking useful analyses, and it is explicitly **not** to adjust thresholds until results appear. The structure of the engine, the data plumbing and the UI can be prepared without freezing any of them. No spec scenario depends on a number that is not a documented default.

### D1. Deterministic engine computed client-side

All analysis runs in the browser over the transactions, costs, reconciliation and supply data the page already loads, through pure functions under `src/lib/commercial-intelligence/`. Precedent: the Perdas tab and the `/sales` rebuild ("zero new endpoint"), and `add-sales-transaction-detail` D5 (fan-out per store, reduce client-side).

*Alternatives:* (a) a server-side aggregate endpoint or an `intelligence-service` read model. Rejected for now: it would need a service, migration and permissions before we know which analyses operators keep; ~11k rows per month is cheap to reduce in the browser. Revisit when history grows past a few months or coupon analysis needs multi-month windows. (b) an LLM to write recommendations. Rejected: not explainable by data, and the repo has no LLM path; the copy is templated from evidence.

### D2. Baskets for association come only from coupons, behind a coverage gate

An association basket is the set of distinct SKUs sharing `${store_id}:${coupon}` (non-empty coupon), with OK lines only. Lines without a coupon are counted as orphans and never become one-item baskets for association (a fake one-item basket inflates every product's basket count and depresses lift). Headline KPIs keep using `groupBaskets` for parity with `/sales`.

Coverage (share of OK lines and of revenue with a coupon) is measured per store and network:

| State | Condition | Effect |
|---|---|---|
| `blocked` | eligible baskets below the minimum, or coupon baskets rarely multi-item (< 5%), or no eligible store | Only the coverage card is shown, with what would unblock it |
| `partial` | any store below 80% coverage, or network coverage in [0.80, 0.95) | Runs on eligible stores only; excluded stores listed; basket-based recommendations capped at Medium |
| `open` | network coverage ≥ 0.95 | Runs normally |

A basket whose lines span more than 30 minutes is treated as a reused coupon, dropped and counted. *Rejected:* estimating baskets for coupon-less lines (invented data); all-or-nothing network gating (one bad store would hide the others).

### D3. Lift with a conservative lower bound; rank by excess, not confidence

For a pair (X, Y) over N eligible baskets with `nX`, `nY`, `nXY`: `support = nXY/N`, `conf(X→Y) = nXY/nX`, `lift = nXY·N/(nX·nY)`. To avoid ranking noise, the engine uses a lower bound `liftLB = lift · exp(−z·√Var)` with `Var(ln lift) ≈ 1/nXY − 1/nX − 1/nY + 1/N + 2(lift−1)/N` and `z = 2.58`. A pair is **reliable** only if `nXY ≥ 8`, `nX ≥ 20`, `nY ≥ 20` and `liftLB ≥ 1.3`. Pairs are ranked by `excess = nXY − nX·nY/N` (extra joint baskets over chance), which prevents very popular items from dominating; confidence alone never ranks. The anchor is the rarer item.

Hand-checked: N=1000, nX=nY=100, nXY=40 → lift 4.0, Var 0.012, LB ≈ 3.02. N=10, nX=nY=4, nXY=3 → lift 1.875 but LB(1.96σ) ≈ 0.98, so not reliable.

At store level pairs are **not mined**: a store-month has ~400 baskets. Instead, for the network's top 100 pairs the engine flags a *deviation* when `nX_s ≥ 15`, `conf_s ≤ 0.5·conf_network` and the Wilson upper bound of `conf_s` is below `conf_network`. *Rejected:* store-only mining (spurious pairs); point-estimate lift with a fixed threshold (passes tiny samples).

### D4. Three-way classification: association is not a discount

```
0. not reliable (D3)                                  → not listed
1. conv = conf(X→Y)
2. conv ≥ 0.25                                        → STRONG ASSOCIATION: joint exposure only.
      If fullPriceShare ≥ 0.85 (with ≥ 70% of joint baskets having a known discount state):
      "a preço cheio — desconto reduziria margem sem vender mais".
3. else, if anchor-only baskets (nX − nXY) ≥ 30:
      demandReason = Y's expiry loss ≥ 10% of its sold value (valid loss data) OR Y is "under-explored potential"
      d* = largest d in {5, 10, 15}% with simulateCombo(...).marginPct ≥ minMargin AND requiredHeadroomConversion ≤ 0.50
      demandReason AND d* exists                      → PROMOTIONAL OPPORTUNITY (candidate test, with break-even)
      otherwise                                       → CROSS-SELL POTENTIAL (communication/offer, no price cut)
```

`fullPriceShare` = joint baskets whose two lines are both at full price ÷ joint baskets with a known discount state (a line is `full` if `discount = 0` or `original = paid`; `discounted` if `discount > 0` or `original > paid`; `unknown` if both are null). In classes 3a/3b it also feeds a cannibalization warning: `nXY_full × discount` of margin given to combos that already sold at full price. The engine cannot measure elasticity, so a promotional opportunity is only ever a candidate test.

### D5. Observed price over list price; margin over resolved-cost lines only

The simulator's unit price is the mode of `original/quantity` (or `paid/quantity`) over the period's last 7 days when there are ≥ 5 observations, otherwise the whole period. List price is shown alongside as a cross-check (badge if it differs by > 5%) when it resolves; today it almost never does.

Margin is computed over lines whose cost resolves, so the numerator and the revenue base match. `sales-insights.ts`'s `computeMargin` keeps the revenue of unresolved-cost SKUs in the base while dropping only their cost, which overstates margin (and a per-SKU row with unresolved cost reads as 100% margin). The new engine therefore does **not** reuse `computeMargin`, `productSalesRows` or `classifyProductMatrix`; `/sales` and this page can differ when unresolved SKUs exist, and that is documented. Fixing `/sales` is a separate change.

*Rejected:* reusing the existing margin helpers (inherits the defect); using the sales file's CMV/Margem columns (deliberately never read; `finance-service` is the only COGS source).

### D6. Product return classes by percentile inside the scope

Per SKU in scope (resolved-cost lines only): revenue, units, margin R$ and %, loss R$ by reason, `marginAfterLoss = margin − loss` (null if either unknown), velocity (units per day with sales), `sellingDaysShare`, longest sales gap, sell-through. Percentiles `pRev, pQty, pContrib, pMarginPct, pUnitMargin` are taken across the SKUs of the same scope (not per category, because the vocabulary is unreliable).

Eligibility: fewer than 10 units or unresolved cost → "Dados insuficientes"; fewer than 14 days with sales → "Em observação" (judged by velocity, not volume); possible unavailability (share of selling days < 0.5 or a gap ≥ 7 days) → no adverse class, "Em observação: disponibilidade incerta".

Classes, first match wins:

| # | Class | Rule |
|---|---|---|
| 1 | Baixo retorno econômico | `marginAfterLoss < 0`, or `pContrib < 0.25 ∧ pQty < 0.5` |
| 2 | Motor de resultado | `pContrib ≥ 0.80` (margin % ignored) |
| 3 | Volume sem retorno | (`pQty ≥ 0.6` or `pRev ≥ 0.6`) `∧ pContrib < 0.4`; tagged low margin or high loss |
| 4 | Estrela | `pQty ≥ 0.5 ∧ pMarginPct ≥ 0.5 ∧ pContrib ≥ 0.5`, not a driver |
| 5 | Potencial subexplorado | `pQty < 0.4 ∧ (pMarginPct ≥ 0.6 ∨ pUnitMargin ≥ 0.6)`; always Estimated, confidence ≤ Low |
| — | (none) | intermediate |

Availability proxy limit, stated in the UI: "sem vendas por N dias seguidos (pode ser ruptura ou baixa procura — não há estoque diário para confirmar)". *Rejected:* extending `classifyProductMatrix` (defect above, different quadrant semantics); a single ranking metric.

### D7. Wall-clock time through UTC accessors

`wallClock(occurred_at)` returns `{day, hour, weekday}` from `getUTC*`, with a comment explaining why. The existing `heatmapData()` and the store profile's day/hour use `getDay()/getHours()`; in a BRT browser that shifts hours by −3 and can flip the weekday for 00:00–02:59. Recorded as a follow-up finding for `/sales`. *Rejected:* fixing `/sales` here (widens a dirty-tree change); applying a hard-coded −3 offset (breaks for any other viewer or future DST).

Dayparts: Manhã 06–10, Almoço 11–14, Tarde 15–17, Noite 18–21, Madrugada 22–05, plus weekday/weekend. Rules run only on dayparts with ≥ 40 baskets: **H1** category share in the daypart ≥ 1.5× its share outside, with ≥ 25 baskets of it; **H2** attach rate ≥ 10 percentage points lower than outside, two-proportion |z| ≥ 2, ≥ 40 anchor baskets; **H3** ticket ≥ 20% above the scope (informational). H1 + H2 on the same anchor and daypart → "consumo forte, baixa inclusão → teste segmentado". The weekday × hour heatmap is descriptive only.

### D8. Similar stores by demand pattern, not by outcome

Store attributes are unusable (all `type = company`, `headcount` and `opened_on` null), and similarity on category mix would be circular (category mix is an outcome we benchmark) and non-discriminating (cosine on share vectors is ~0.95+ for almost any pair). Each store gets a 10-bin distribution of baskets over (day type × daypart); `similarity = 1 − Hellinger(p, q)`; peers are the top 3 among other stores with ≥ 100 baskets and a basket-count ratio in [0.4, 2.5]. Fewer than 2 eligible peers → fall back to the network reference ("sem lojas parecidas suficientes"). Benchmarks pool numerators and denominators across peers and are always shown next to the network reference. Store gaps: ticket ≥ 15% away with Welch |t| ≥ 2 and ≥ 100 baskets each side, decomposed into items per purchase × average item price; attach-rate gaps by two-proportion |z| ≥ 2.

### D9. Graduated confidence with hard caps

Confidence is a score plus caps, not a boolean gate: with every store-month reconciliation currently incomplete, a binary rule would cap every loss-based recommendation forever.

| Factor | Max | Rule |
|---|---|---|
| Evidence size `n` | 30 | below gate = insufficient; ≥ gate 10; ≥ mid 20; ≥ high 30 (pair `nXY` 8/15/30; anchor baskets 100/300/800; product units 10/30/100) |
| Days with sales | 10 | ≥ 25: 10; ≥ 14: 6; ≥ 7: 3; < 7: 0 and cap Low |
| Months analysed | 5 | 1: 0; 2: 3; ≥ 3: 5 |
| Stability | 15 | same class/direction in both halves of the period (or both months): 15; one only: 5; contradiction: 0 and cap Low |
| Comparable stores | 10 | ≥ 3: 10; 1–2: 5; network fallback: 2; not applicable is excluded |
| Coupon coverage | 15 | ≥ 0.95: 15; ≥ 0.90: 10; ≥ 0.80: 5; not applicable is excluded |
| Cost resolution (involved SKUs) | 10 | 100%: 10; ≥ 95%: 7; ≥ 80%: 3; else 0 and margin claims withheld |
| Reconciliation (only when loss is used) | 10 | SKU clean and < 20% of the store's SKUs flagged: 10; SKU clean, store ≥ 20%: 6; SKU flagged: 0 |

`score = 100 × earned ÷ applicable max`; High ≥ 70, Medium ≥ 45, Low otherwise. **Hard caps**, listed to the user: coupon coverage in [0.80, 0.95) → Medium; SKU flagged `inconsistent_stock` while loss is used → Medium, or Low when loss is the main driver; reconciliation unavailable and loss is the main driver → insufficient; contradiction, < 7 days with sales, or a store with < 100 baskets → Low; a primary claim that is a proxy estimate (availability, potential) → Low. A clean cross-sell pair with one month reaches (30+10+0+15+15+10)/85 = 94%: attainable, not free. The rubric is an **MVP**: the weights and tiers are judgment written before any real outcome exists, so it is versioned (D22) and structured to be recalibrated later against the observed performance of recommendations (predicted confidence versus realized result), not to stay a sum of arbitrary points forever.

Insufficient data always reads `Dados insuficientes para recomendar {X}: {condition} (mínimo {minimum}). {what is missing}.`, where the condition carries the observed number ("só 46 compras com cupom"); this is the wording of the spec scenario, and it reads better than repeating the number as `46 < 100`. Conditions: coupon gate closed; `nXY < 8` or `nX/nY < 20`; anchor baskets below the gate; daypart < 40 baskets; product < 10 units or unresolved cost; no impact reference (impact only); scope with < 200 OK lines or < 7 days. The "O que ainda não sabemos" block also lists standing limits: no daily stock, no promotion history (elasticity), no visit dates, limited category vocabulary, loss known only monthly.

### D10. Impact = observed gap × an explicit capture assumption; priority separate from confidence

Impact is shown in business language as **Estimativa de impacto**: three monthly scenarios, conservative, expected and optimistic (`0.2`, `0.4`, `0.6` × the observed gap by default, D21), labelled Estimated, with the premise written on the card ("assume recuperar só parte da diferença; é uma premissa de potencial, não um resultado medido nem garantido"). No observable gap → "Impacto não estimável". Priority is decided from the expected scenario `impactExpected = 0.4 × gap` (the midpoint of the range) in R$ of margin per month, against `scopeMonthlyMargin` (the scope's resolved-cost margin in the period ÷ the number of months in the period): the item is not listed when `impactMid < R$ 10`; otherwise High when `impactMid ≥ 1%` of `scopeMonthlyMargin` and `≥ R$ 30`, Medium when `≥ 0.3%` and `≥ R$ 30`, else Low (D17 has the full calculation and a worked example); Low confidence caps priority at Medium; insufficient items are not listed (they go to "O que ainda não sabemos"); a null impact is Low. Ranking is **not** the impact alone (D20): within a priority the order combines the expected impact, the confidence, the effort of the action and the risk to margin or loss. The full list is capped technically at 30 items with ~5 per detector, but the main screen shows only the few that matter (a business rule, default 5) and offers the rest on demand.

| Detector | Objective | Impact before capture |
|---|---|---|
| pair-strong | Ticket | none |
| pair-crosssell | Ticket | `gapToReference × unitValue` |
| pair-promo | Novo teste | none; shows break-even and required conversion |
| cart-gap | Ticket | `(refRate − rate) × anchorBaskets × unitValue` |
| hour-gap | Novo teste | `(baselineRate − rate_d) × anchorBaskets_d × unitValue` |
| store-gap | Ticket | `(peerTicket − ticket) × baskets × marginShare`, only when the decomposition is clear |
| product-class | Margem / Novo teste | volume without return: `(medianMarginPct − marginPct) × revenue`; expiry/damage loss: `loss × avoidable share by cause`; `other_reason`: none; potential: Estimated, Low; low return: none |

Cart-gap reference: network = P75 of the attach rate across stores with ≥ 60 anchor baskets; store = pooled peers (≥ 2) else the network P75; no reference → not estimable. Gates: anchor baskets ≥ 100 (network) / 60 (store); partner base rate in [0.05, 0.95]. *Rejected:* a fixed R$ per opportunity; deriving priority from confidence alone.

### D11. Loss is consumed with its cause; never theft, never an automatic removal

| Situation (SKU × scope) | Wording |
|---|---|
| expiry ≥ 50% of the SKU's loss and sell-through < 0.6 | turnover/over-supply: "vendeu X% do abastecido; revisar quantidade e frequência antes de avaliar o produto" |
| expiry-dominant, no sell-through | "perda concentrada em validade; revisar giro e abastecimento" |
| damage ≥ 50% | handling: "revisar manuseio, embalagem e transporte; não indica produto ruim por si" |
| `other_reason` ≥ 50% | "perda em 'Outro motivo' (sem classificação confiável): não interpretar como causa específica; padronizar o registro" |
| sell-through ≥ 0.8 ∧ margin ≥ scope median ∧ loss present | "gira bem e tem margem; a perda é operacional, investigar a causa — não é caso de retirar do mix" |
| `marginAfterLoss < 0` | class Baixo retorno; "avaliar causa da perda e preço antes de decidir permanência" |

No recommendation uses remove/withdraw as an instruction. `unclassified_stock_adjustment` stays out of margin after losses and appears only as a data-quality item. The existing Perdas tab stays the only loss screen.

### D12. Combo simulator formulas (pure, nothing persisted)

```
P = pA + pB    C = cA + cB    m0 = P − C    mp0 = m0 / P
D = P − P'     d = D / P      m1 = P' − C   mp1 = m1 / P'
k = m1 > 0 ? D / m1 : ∞                  (= m0/m1 − 1)   extra volume to keep the same total contribution
extraCombos = nXY · k
requiredHeadroomConversion = extraCombos / (nX − nXY)
cannibalized = nXY_full · D
P_min = C / (1 − minMargin)    D_max = P − P_min
status: mp1 < minMargin → "abaixo da margem mínima"; m1 ≤ 0 → "inviável"
```

Worked example: P = 1500, C = 700 → m0 = 800 (53.3%). P' = 1350 → D = 150, m1 = 650 (48.1%), k = 23.08%; with nXY = 40 → ≈ 9.2 extra combos; with 160 anchor-only baskets → ≈ 5.8% required conversion; minMargin 30% → P_min = 1000, D_max = 500 (33.3%). If either product's cost is unresolved the simulator refuses. `P'` and the minimum margin are user inputs labelled assumptions. The minimum margin is a **business rule, not a constant in the code and not a per-browser setting** (D16): its value is the company's single official value for the operation (30% by default, chosen below the ~50% network gross margin so that it only blocks combos that eat most of the margin), shown read-only in the simulator; the viewer's what-if input is the proposed price, and percentage and R$ inputs share one source of truth (`proposedPriceCents`).

### D13. Data flow, sequencing and performance

Hooks (same argument shapes as `/sales` and Perdas so the RTK cache is shared): stores; products; network transactions for the period; network transactions for the comparison period (non-blocking; error or empty means "Sem comparação"); dated costs for the network's SKUs (`asOf: "${period}-01"`, keyed on the sorted SKU list so a store switch never refetches) and, when a comparison is asked for, the same lookup for the comparison period's own SKUs (`asOf: "${comparePeriod}-01"`: a fair previous margin needs the cost as it stood then, as `/sales` does); network reconciliation for the six months ending at the period (only the period's per-store slice is used); network supply for the period (sell-through only); list price for the two simulator SKUs (reference only). Loading order: stores, products and current transactions first; comparison, reconciliation and supply only after transactions resolve, to avoid ~100 simultaneous requests against the browser's connection limit and the gateway's 3 s per-call timeout (first visit ≈ 100 requests, versus ≈ 49 for `/sales` and ≈ 72 for Perdas).

`buildDataset` is one O(L) pass over ~11k OK lines, memoized; pairs only among SKUs with ≥ 20 baskets; baskets with more than 12 distinct SKUs are skipped for pairs (counted, not silent); store deviations only for the top 100 network pairs; the scope analysis is memoized and its inputs deferred (`useDeferredValue`). Budget ≲ 150 ms of scripting per scope change, measured in a performance trace; if exceeded, defer first, and a Web Worker only as a later optimization. Heavy tables are their own `memo` components with stable props (the `/treasury` lesson). The admin's ESLint enforces React Compiler purity rules: no `Date.now()` in render, no `setState` in effects (reset children with `key`; the evidence sheet's open state derives from the selected key).

Period options: the last 24 months plus the current month labelled "em andamento". Category is a view filter (D2's baskets stay whole); until the analyses that use it are released the control is present but switched off, with its reason on the page, because a control that does nothing reads as broken.

### D14. Code layout

```
src/app/(app)/commercial-intelligence/page.tsx        thin: filters, hooks, buildDataset, analyzeScope, tabs
src/lib/commercial-intelligence/                      pure engine, relative imports and `import type` only
  types · thresholds · dataset · quality · loss-index · associations · cart-gaps
  combo-simulator · product-returns · hourly · peers · confidence · opportunities · copy · index
src/components/commercial-intelligence/               tabs and small atoms
  filters-bar · data-quality-banner · kpi-card · overview-tab · opportunity-center · opportunity-card
  evidence-sheet · combos-tab · combo-simulator · products-tab · behavior-tab · stores-tab
  provenance-badge · confidence-badge · suggestion-tag · shared
```

A folder instead of one file because `sales-insights.ts` is already 845 lines and dirty; each module stays under ~400 lines and owns its own thresholds (all defaults live in `thresholds.ts`, injectable per call). The engine avoids enums and namespaces (erasable TypeScript) so a plain Node 24 can run it for verification. Reused as-is: `onlyOk`, `isOk`, `groupBaskets`, `categoryLabel`, `categoryMix`, `productAffinity`, `WEEKDAY_LABELS`, `DeltaTag`, `RequestState`, `StatusBadge`, `PageHeader`, formatters and shadcn `Sheet`/`Tabs`/`Table`/`Tooltip`/`Card`/`Select`/`Input`.

### D15. UI patterns

- Tabs: Overview · Combos & Cross-sell · Products · Behavior · Stores · **Qualidade dos dados** (D19). The header offers two entries that are not tabs: "Regras de negócio" (the few decisions of the company, read-only here) and a link to "Configurações avançadas / calibração" (a separate page, D16). Only the active tab mounts.
- `ProvenanceBadge` on `StatusBadge`: Observado (facts and assumption-free metrics; neutral) vs Estimado (projections and assumption-dependent values; attention), tooltip carries the repository's FATO / MÉTRICA DERIVADA / PREMISSA / ESTIMATIVA label. `ConfidenceBadge`: text plus a shield icon, never colour alone.
- "✦ Sugestão IA": lucide `Sparkles` outline in `text-primary` (icon only) with the label in `text-foreground` (small `text-primary` on the dark card measures ~3.4:1 and fails 4.5:1; the icon passes the 3:1 graphical-object rule already covered by `pnpm contrast`). The recommendation block carries `border-l-2 border-l-primary`, the same accent as the active sidebar item. No token changes. The tooltip states it is rule-based statistics over observed data and nothing is applied automatically.
- Drill-down: an `EvidenceSheet` opened from any center row, pair or product; breadcrumb Rede › Loja › Produto; the last level lists up to 10 real baskets. Clickable rows follow `SummaryCard`'s `role="button" tabIndex={0}` pattern.
- Data-quality banner: items ordered critical > attention > info, each stating its effect; collapsed only when all items are info.
- Copy: evidence first (numbers, period, n, Observado); interpretation hedged, never causal; impact as a range with its assumption; recommendation proposes a test or a review, never an order.

### D16. Three kinds of rule, kept apart in the code and in the interface

Every parameter is tagged with a `kind` (typed, so an untagged one fails the typecheck) and lives in one typed `parameters` object with documented defaults, overridable at build time by `NEXT_PUBLIC_CI_*`. Engine functions receive the parameters as an argument; no module keeps its own constants.

| Kind | What it decides | Who owns it | Where it appears |
|---|---|---|---|
| **Business rule** | a decision of the company: minimum combo margin (30%), largest discount worth testing (15%), impact below which nothing is listed (R$ 10/month) and the floor for priority (R$ 30/month), how many opportunities the main screen shows (5) | the manager | read-only in the main experience ("Regras de negócio"), with its source |
| **Data-quality rule** | whether there is enough data: coverage bands, sample minimums, cost resolution, availability limits | the model, provisional | indicators and blocks in "Qualidade dos dados"; the thresholds themselves only in the advanced area |
| **Analytic model** | how association, trend, similarity, confidence and opportunity are computed: lift bound, z, percentiles, Welch t, evidence tiers, confidence tiers, scenario premises, ranking weights | the model, provisional | only the advanced and calibration area |

*Business rules* have one value for the whole operation. A value chosen in one browser would make two viewers receive different recommendations, so they are **never stored in the browser**. Their official home is the backend register of `add-commercial-intelligence-governance` (single value, permission to edit, change history). Until that change exists the value is the deployment default and the page says the official register is pending; there is no local override. This replaces the earlier per-viewer override of the minimum margin and the capture range.

*Data-quality and analytic parameters* stay as they are, all provisional (D0), in a separate route `/commercial-intelligence/calibration` ("Configurações avançadas / calibração"). Each is documented with its **name, purpose, formula, unit, current value, reason for the default, where it is used and the effect of raising or lowering it**; this documentation is part of the typed table, so a parameter cannot exist without it.

*Personal presentation preferences* (a collapsed section, a chosen tab) MAY live in the browser; nothing that changes what is recommended may.

Environment variables are read where Next inlines them (`env.ts`); an invalid value is ignored and reported, never fatal.

### D17. How the threshold indicators are computed, what they control, and how they will be calibrated

**Coupon coverage (defaults 80% and 95%; judgment, not measured).**

- *Store coverage* `= couponLines(s) ÷ okLines(s)` for store `s` in the period. Numerator: lines with `result = OK` whose `coupon` is non-empty after trimming. Denominator: **all** `OK` lines of that store in the period (one line is one SKU row of a transaction), with or without a coupon. Declined and cancelled lines are in neither.
- *Network coverage* `= Σ couponLines ÷ Σ okLines` over all stores that have transaction detail, pooled (a large store weighs more; it is not the average of the store percentages).
- *Revenue coverage* (`Σ amount_paid` on coupon lines ÷ `Σ amount_paid` on all OK lines) is shown alongside for information and controls nothing.

| Band | Decision the system takes |
|---|---|
| store coverage `< 80%` (exclusion threshold) | that store's baskets are left out of the pair and missing-from-cart analyses, and it is listed as excluded with its figure; its own ticket and items-per-purchase KPIs are still shown, with a warning icon, because they use the parity definition of a purchase |
| store coverage `≥ 80%` | the store is eligible |
| network coverage `≥ 95%` and no store excluded | state `open`: analyses run over all stores, full confidence range |
| network coverage in `[80%, 95%)`, or any store excluded | state `partial`: analyses run over eligible stores only, and basket-based recommendations are capped at Medium confidence |
| too few eligible baskets, or the share of coupon baskets with more than one item `< 5%` | state `blocked`: only the coverage card is shown |

Coverage also feeds the confidence score of a basket-based recommendation through the coverage of the recommendation's scope (the store's for a store scope, the network's for a network scope): `≥ 95%` earns 15 points, `≥ 90%` 10, `≥ 80%` 5 (D9).

Why these numbers: a line without a coupon is a purchase, or part of one, that cannot be placed in a basket. If coupons are missing at random the association measures stay unbiased and merely rest on fewer baskets; the danger is missingness that correlates with basket content (multi-item purchases losing the coupon more often, or one machine model not printing it), which underestimates co-purchase and overstates cart gaps. 95% keeps what is left out small enough for the stability rule to absorb; below 80%, more than one line in five is outside the analysis, so the direction of the bias can no longer be assumed harmless. No real coupon data has been seen yet, so these are judgment defaults.

*Calibration before freezing (tasks group 5):* (1) the distribution of `storeCoverage` over every store-month of the imported real months (how many are `≥ 95%`, in `[80%, 95%)`, `< 80%`); (2) a bias diagnostic comparing coupon lines with coupon-less lines on category mix, average line value, hour of day, POS and machine model; a material difference means the missingness is informative, and thresholds rise or the affected POS is excluded; (3) a sensitivity run recomputing the top pairs and cart gaps using only stores `≥ 95%` versus all stores `≥ 80%` and checking how much the top-ten lists overlap; if they agree, 80% is safe. The result and the frozen defaults are written back here.

**Impact scenario premises (defaults 20% / 40% / 60%; a premise, not computed; presented as "Estimativa de impacto", D21).** The text below keeps the arithmetic of the earlier "capture range": low = conservative, mid = expected, high = optimistic.

- It is a dimensionless multiplier on an *observed gap*, so it has no denominator of its own: `impactLow = 0.20 × gap`, `impactHigh = 0.60 × gap`, `impactMid = 0.40 × gap`, in R$ of margin per month (`gap` is divided by the number of months when the period spans more than one). It states an assumption: that a light-touch action (joint exposure, an on-shelf or on-screen message) recovers between a fifth and three fifths of the distance to the reference. No experiment has measured this.
- The observed `gap` and its denominators, per detector:
  - *Cart gap:* `gap = (refRate − rate) × anchorBaskets × unitMargin`. `rate` is the anchor baskets containing the partner category ÷ `anchorBaskets`, the baskets in the scope and period with at least one line of the anchor category. `refRate` is the P75 of the same rate across stores with at least 60 anchor baskets (network scope), or the pooled rate of the similar stores (at least two) for a store scope. `unitMargin` is the mean margin in R$ of the partner category's lines in baskets that have it, over cost-resolved lines.
  - *Daypart gap:* `(baselineRate − rate_d) × anchorBaskets_d × unitMargin`, where `baselineRate` is the attach rate outside the daypart in the same scope and `anchorBaskets_d` the anchor baskets inside it.
  - *Cross-sell pair:* the gap between the pair's conversion and the reference conversion, times the anchor baskets, times the partner's unit margin.
  - *Store ticket gap:* `(peerTicket − ticket) × baskets × marginShare`, only when the ticket decomposition is clear.
  - *Volume without return:* `(medianMarginPct − marginPct) × revenue`.
- Worked example: 600 baskets with a meal, 30% of them with a beverage, reference P75 of 58%, partner unit margin R$ 3,00 → `(0.58 − 0.30) × 600 = 168` baskets a month, `gap = 168 × 3 = R$ 504`; impact range R$ 101–302 (mid R$ 202). With a network margin of R$ 40,000 a month, 1% is R$ 400 and 0.3% is R$ 120, so `impactMid = R$ 202` is **Medium** (at least 0.3% and at least R$ 30) and not High.
- Decisions it controls: (1) the range printed on the opportunity card, labelled Estimated with the assumption written out; (2) the priority, through `impactMid` against `scopeMonthlyMargin` as in D10 (the denominator is the scope's resolved-cost margin in the period divided by the months in the period); (3) the order inside a priority (by `impactMid`). It never changes which opportunities exist, the evidence behind them or their confidence.
- Sensitivity: priority uses the midpoint, so the multiplier 0.4 scales priorities directly; if the true capture were 10%, the midpoint would be overstated fourfold and many High items would fall to Medium or Low. That is why the premises are visible, documented analytic parameters (D16, D21) that are calibrated, never edited per viewer. It will be replaced by measured uplift per action type once `add-commercial-experiments` exists.

### D18. Verification without synthetic data in real databases

Synthetic data never enters the real or shared databases and never mixes with real analysis. The pure engine is exercised with in-memory fixtures (a throwaway script outside the repo). The live UI is checked against a **local mock gateway** (a small process outside the repo serving labelled fixtures for the endpoints the page calls), with `NEXT_PUBLIC_GATEWAY_URL` pointing at it and `NEXT_PUBLIC_ALLOW_SYNTHETIC=true` for that run only; every synthetic entity is named with a visible "[SINTÉTICO]" prefix, and in a run against the real gateway any entity carrying the marker is excluded and reported by the data-quality banner. The running stack's `sales_transaction` table is never written. Final acceptance uses the operator's real imported months. *Rejected:* the earlier idea of inserting marked synthetic rows into the running dev database for a month without real data, which would have shown fake numbers in `/sales`, `/supply` and this page.

### D19. Availability is a first-class result: available, available with caveats, insufficient

Every analysis reports one of three states plus the indicators behind it, and the page shows them together in the "Qualidade dos dados" tab. A deficiency **blocks** only when it makes the analysis impossible or misleading; otherwise it lowers confidence and is listed as a caveat.

| Analysis | Available | Available with caveats | Insufficient |
|---|---|---|---|
| Combos & cross-sell | coupon gate open | gate partial (stores excluded, confidence capped at Medium) | gate blocked; or, for one store, too few coupon baskets |
| Product return | costs resolved for ≥ the high share of revenue and enough SKUs with the minimum sample | costs or samples between the minimum and the high share | costs unavailable or below the minimum share; too few eligible SKUs |
| Loss and margin after losses | every store reconciled and complete | some store not reconciled or incomplete | no reconciliation loaded or no store covered |
| Behavior by time | enough lines with a readable timestamp | some lines undated | too many undated lines or too few lines |
| Stores and similar stores | enough stores with the minimum purchases to find peers | peers missing for some stores (network shown as a labelled secondary reference) | no store reaches the minimum |
| Comparison and history | enough months with detail | one or two months (no stability between months) | no month with detail |

The thresholds that separate the states are data-quality rules (D16). `assessAvailability` is pure and reads the same measurements as the rest of the engine.

### D20. Principles every recommendation must obey

1. **Insight ≠ recommendation.** "Ticket no almoço é 18% maior" is an insight (evidence, comparison, confidence, no action); a recommendation exists only when a rule links an observation to a concrete, testable action. A correlation never becomes an action by itself.
2. **No single threshold.** Classifications combine volume, financial contribution, margin, availability, history, loss and store context (D6); crossing one percentile is never enough. A new product, one restocked in too few units, or one that went out of stock is never judged as if it had had normal exposure.
3. **Absence of evidence is an answer.** "Não há evidência suficiente para recomendar uma ação" is shown instead of filling the screen.
4. **Consolidate by cause.** Detectors that describe the same cause on the same product/category/store become one opportunity listing its supporting detectors.
5. **Rank by more than impact.** Within a priority the order weighs expected impact, confidence, effort and risk to margin or loss, using explainable weights that are analytic parameters (provisional). A R$ 500 estimate with Low confidence does not outrank a R$ 350 one with strong evidence.
6. **Few on the main screen.** The main screen answers "where does my attention pay off now?" with a business-rule number of opportunities; the rest is one click away. The technical cap does not decide how many cards appear.
7. **Origin is recorded.** Each opportunity carries its origin: baskets, product, time, similar store, loss, margin or mix.
8. **No discount first.** For associated products the order of suggestions is joint exposure, communication, positioning, cross-sell, and only then price, and only with evidence of incremental behavior and the minimum margin preserved (D4).
9. **Benchmarks: own history, then similar stores, then the network.** The network average is a secondary reference. Whenever similar stores are used the page lists which stores and the main similarity factors (D8), so it is never a black box.
10. **Every recommendation is explainable:** the data behind it, the period, the benchmark, the sample size, the confidence and its factors, and the limitations.
11. **Observed next to estimated.** "Margem observada: R$ X · Impacto potencial estimado: R$ Y–Z · Confiança: média." A projection is never shown as a fact.

### D21. Impact is shown as three scenarios and a premise, never as a precise figure

The "captura da lacuna" of D10/D17 is presented in business language as **Estimativa de impacto**. The observed gap is multiplied by three scenario premises: conservative `0.2`, expected `0.4`, optimistic `0.6` (defaults, provisional). The expected value is what priority uses, so behavior is unchanged from D10. The card states that it is a premise of potential, not a measured or guaranteed result, and shows the range ("potencial estimado de R$ 220–660/mês"), not a point value. The three premises are analytic parameters of the advanced area: they are not a decision of the manager and are not editable per browser. When experiments exist, predicted versus realized impact will calibrate them (`add-commercial-intelligence-governance`).

### D22. Versioning of the logic

The engine exports a logic version. Every recommendation carries that version and the values of the parameters in force when it was produced (`Opportunity.logicVersion`, `Opportunity.parameters`), so that a later change never rewrites what an earlier recommendation was based on. This change records them in memory, on the recommendation; persisting them, with the decisions taken (accepted, rejected, turned into an experiment) and the results, is `add-commercial-intelligence-governance`.

### D23. A calibration report gates the analytic groups

The calibration of tasks group 5 produces a report over the real months: the distribution of coupon coverage, of sample sizes and of costs, and how the provisional parameters would behave: how many stores would be excluded, how many products would have no data, how many pairs would pass the filters, how many opportunities would be generated, and how many recommendations would be blocked. It is a decision aid for the operator; the result never tunes a threshold "to make results appear", and only approved values are written back and stop being marked provisional.

## Risks / Trade-offs

- **The analytic rules have not been validated on real data** (the coupon fill rate, the history and the store behavior are unmeasured) → D0: every threshold is a provisional, configurable default, shown as provisional, and calibrated in tasks group 5 before any analytic group is implemented.
- **Catalog vocabulary** (1 `meal` SKU; marmitas are `snack`) → the briefing's headline examples (meal without beverage; marmitas 11–14h) do not surface from `category` today. Mitigation: category-generic detectors, a banner with the real counts, and the taxonomy fix as a data task (roadmap item 2). No name-based heuristic.
- **Coupon coverage is unmeasured** (fixture and local table are empty) → in production the Combos tab may open blocked. Mitigation: the coverage gate; acceptance requires a real August export uploaded through `/ingestion` (which does delete+create per store-period and triggers downstream recompute, so the operator decides when).
- **Every reconciliation is incomplete** → loss-based recommendations will mostly be Medium or Low, and the banner will look alarming because it is true. Mitigation: graduated confidence per SKU × store (D9).
- **One complete transaction month** → no cross-month stability and an empty comparison. Mitigation: stability from the two halves of the month; "Sem comparação" is a first-class state.
- **All-or-nothing transaction query** (one store failing fails the whole network query; finance errors are swallowed per store) → Mitigation: sequenced loading, `monthsWithData === 0` means "loss unavailable", never zero. Not fixed in this change.
- **Multiple comparisons** → even at z = 2.58 an occasional spurious pair passes. Mitigation: each pair shows its counts and stability so it can be dismissed; no pair drives an automatic action.
- **Dirty base** → `sales-insights.ts`, `loss-insights.ts`, `store-insights.ts`, `components/sales/`, `components/supply/`, `lib/api/sales.ts` and the transaction backend are uncommitted. The page is additive and touches only the sidebar (already modified) and two docs. Commits must stage this change's files by explicit path.
- **No test runner in the admin** → a ~2,000-line engine without permanent regression protection until `add-admin-test-runner`. Mitigation: pure functions with hand-computed fixtures run through a throwaway script (outside the repo) plus live browser checks.
- **Business rules are not yet persisted** → until `add-commercial-intelligence-governance` lands they are read-only deployment defaults and the page says the official register is pending; a per-browser edit would let two viewers get different recommendations, so none exists.
- **Permission mismatch** → `sales:read` shows the item but the page also reads products, finance, supply and stores. Mitigation: per-block degradation ("Sem permissão").
- **Name overlap** → "Comercial" is already a sidebar group (billing). The item lives in "Operação" and is titled "Inteligência Comercial".

## Follow-ups (later changes, with the data each needs)

1. `fix-sales-margin-and-timezone` (none): `computeMargin` base, UTC time in the heatmap and store profile.
2. `update-product-catalog-taxonomy` (data): marmitas as meal, `subcategory`, `price_version`, `shelf_life_days`.
3. `add-daily-stock-and-visit-dates` (inventory daily snapshots; expose visit finish time): real stock-outs, loss by visit day.
4. `add-mix-intelligence` (2, 3, launch dates): product × store keep/explore/reduce.
5. `add-replenishment-suggestions` (3, `shelf_life_days`): next-visit quantities.
6. `add-commercial-experiments` (persistence, multi-month history, price/promotion calendar): before/during/after and cannibalization.
7. `add-decision-learning` (6): AI vs human decision history.
8. `add-cross-store-mix-opportunities` (2, 4, store attributes).
9. `add-product-tests` (6).
10. `add-admin-test-runner` (none): unit tests for this engine; recommended right after this change.

## Open Questions

- What the calibration of D17 finds (coverage distribution, bias diagnostic, top-list stability); the defaults of coupon coverage, minimum baskets and the capture range are written back into D17 afterwards.
- The exact copy of the "Sugestão IA" tooltip and the label itself can be tuned in review without changing behavior.
- Whether the minimum-margin default (30%) should later be derived from the network margin instead of a constant. It is an editable assumption today.
