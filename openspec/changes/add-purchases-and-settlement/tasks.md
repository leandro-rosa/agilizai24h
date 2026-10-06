## 1. Purchasing model

- [x] 1.1 Prisma models and migration in suppliers-service: purchase, purchase item (condition, payment status), settlement
- [x] 1.2 Repositories and service: create/list/read purchases, validation of supplier and product, cents and integer units
- [x] 1.3 Routes (list, create, update condition/payment before settlement) with tests; gateway routes and permissions
- [x] 1.4 Derive `baseFrom` and month figures per supplier and SKU for the analysis

## 2. Manual entry and invoice import

- [x] 2.1 NF-e XML parser in ingestion-worker-service (issuer, number, date, items) with fixtures and specs
- [x] 2.2 Purchase-invoice file type, upload path, kept raw file, handoff to purchasing
- [x] 2.3 Item resolution (EAN, then SKU/alias; never fuzzy), unresolved list, idempotency on issuer + number
- [x] 2.4 Packaging conversion with `units_per_package`, asking when missing

## 3. Settlement

- [x] 3.1 Weekly computation: delivered, sold (dated receipts), expired and returned (operator-reported), unsold, owed, running balance, partial flag
- [x] 3.2 Proposal storage with evidence; confirm and mark-paid transitions; refuse condition change after settlement
- [x] 3.3 Tests for the Quinoa case (100 delivered, 62 sold, 8 expired, 30 unsold → R$ 310,00) and partial weeks

## 4. Analysis

- [x] 4.1 Real `PurchaseSource` adapter in intelligence-service; month figures, orders, invoices, bought versus restocked
- [x] 4.2 Purchase insights generated from real data with evidence; keep Sept/2026 and earlier unavailable
- [x] 4.3 Exclude bonus from margin, markup, gross profit and attention; report bonus units; reason `bonus`

## 5. Admin

- [x] 5.1 "Pedidos" and "Notas fiscais" pages and menu items
- [x] 5.2 "Importar nota fiscal" flow with unresolved lines review; "Lançar compra" form with per-item condition
- [x] 5.3 Settlement screen: evidence, confirm, mark paid; unconfirmed labelled proposal
- [x] 5.4 Update `/purchases` KPIs, evolution and tables for real purchases and bonus; component specs

## 6. Verification

- [ ] 6.1 Import a real NF-e and enter a manual purchase on the dev stack; check the analysis against them (needs the owner's real NF-e; read-only paths and a throwaway database were verified)
- [x] 6.2 Confirm no synthetic data reached real databases (purchase table in the real DB stays at 0 rows; SQL verified on a throwaway database)
- [x] 6.3 Update CLAUDE.md files; commit, merge and push in the same session
