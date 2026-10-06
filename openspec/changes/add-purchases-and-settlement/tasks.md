## 1. Purchasing model

- [ ] 1.1 Prisma models and migration in suppliers-service: purchase, purchase item (condition, payment status), settlement
- [ ] 1.2 Repositories and service: create/list/read purchases, validation of supplier and product, cents and integer units
- [ ] 1.3 Routes (list, create, update condition/payment before settlement) with tests; gateway routes and permissions
- [ ] 1.4 Derive `baseFrom` and month figures per supplier and SKU for the analysis

## 2. Manual entry and invoice import

- [ ] 2.1 NF-e XML parser in ingestion-worker-service (issuer, number, date, items) with fixtures and specs
- [ ] 2.2 Purchase-invoice file type, upload path, kept raw file, handoff to purchasing
- [ ] 2.3 Item resolution (EAN, then SKU/alias; never fuzzy), unresolved list, idempotency on issuer + number
- [ ] 2.4 Packaging conversion with `units_per_package`, asking when missing

## 3. Settlement

- [ ] 3.1 Weekly computation: delivered, sold (dated receipts), expired and returned (supply removals), unsold, owed, running balance, partial flag
- [ ] 3.2 Proposal storage with evidence; confirm and mark-paid transitions; refuse condition change after settlement
- [ ] 3.3 Tests for the Quinoa case (100 delivered, 62 sold, 8 expired, 30 unsold → R$ 310,00) and partial weeks

## 4. Analysis

- [ ] 4.1 Real `PurchaseSource` adapter in intelligence-service; month figures, orders, invoices, bought versus restocked
- [ ] 4.2 Purchase insights generated from real data with evidence; keep Sept/2026 and earlier unavailable
- [ ] 4.3 Exclude bonus from margin, markup, gross profit and attention; report bonus units; reason `bonus`

## 5. Admin

- [ ] 5.1 "Pedidos" and "Notas fiscais" pages and menu items
- [ ] 5.2 "Importar nota fiscal" flow with unresolved lines review; "Lançar compra" form with per-item condition
- [ ] 5.3 Settlement screen: evidence, confirm, mark paid; unconfirmed labelled proposal
- [ ] 5.4 Update `/purchases` KPIs, evolution and tables for real purchases and bonus; component specs

## 6. Verification

- [ ] 6.1 Import a real NF-e and enter a manual purchase on the dev stack; check the analysis against them
- [ ] 6.2 Confirm no synthetic data reached real databases
- [ ] 6.3 Update CLAUDE.md files; commit, merge and push in the same session
