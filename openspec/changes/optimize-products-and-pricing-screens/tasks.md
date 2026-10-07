## 1. Diagnosis

- [x] 1.1 Find why Products and Pricing disagree (read-only on the dev stack) and record it in the proposal

## 2. Backend

- [x] 2.1 products-service: `brand` and `purchase_unit` on the product (migration, view, create, update); origin `excel`
- [x] 2.2 products-service: `GET /catalogue/last-change` (latest cost or product change) for the pricing freshness
- [x] 2.3 products-service: import preview (new / updates / conflicts) and apply, with the empty-cell rule
- [x] 2.4 gateway: import routes with the session user
- [x] 2.5 intelligence-service: coverage, pending reasons and "newer cost than the period" in the report

## 3. Products screen

- [x] 3.1 Slim table, actions, filters; price and margin out of the table
- [x] 3.2 New product (the same registration form), edit with brand and units, link to pricing
- [x] 3.3 Import Excel wizard (template, mapping, preview, apply) and the pricing-spreadsheet import under it; remove the sync button
- [x] 3.4 Export catalogue (cost with date, no price or margin)

## 4. Pricing screen

- [x] 4.1 Three cards and the coverage; compact pending list with reason and way to fix
- [x] 4.2 Leaner table, default target in the header, More filters, one Export button, collapsible quality summary, technical details into the calculation details
- [x] 4.3 Detail: method and origin of the cost, fees and taxes, kind of margin, target, premises; Edit registry link
- [x] 4.4 Report freshness banner; "custo novo depois do período"

## 5. Verification

- [x] 5.1 Tests for every item above, typecheck, lint; document in the CLAUDE.md files
