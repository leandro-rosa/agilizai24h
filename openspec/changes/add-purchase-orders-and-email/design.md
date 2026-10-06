## Context

Purchases (`add-purchases-and-settlement`) are facts recorded after the fact: `Purchase` + `PurchaseItem` in suppliers-service, read by the analysis (`/purchases/summary`) and by the weekly settlement. There is no e-mail capability anywhere in the repo, PDF is generated only in the browser (`@react-pdf/renderer`, monthly summary), and the gateway knows the logged-in user (`@Caller()`) but does not pass it to domain services; the existing pattern injects `confirmed_by` into the request body. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Order stages with who/when, a history, and received quantities.
- "Purchased" means received; open orders are information.
- Send a requisition by e-mail, with preview, explicit confirmation and a log.

**Non-Goals:**
- An approval step (the owner chose none).
- Drag and drop on the board.
- Receiving in parts with a remaining balance (see open questions); e-mail to the supplier about invoicing or receipt; supplier replies (no inbox).
- Stock movement: receiving records the purchase; restock still comes from the supply reports.

## Decisions

1. **Extend `Purchase` with a stage, not a new Order table.** One record from requisition to receipt keeps invoice, items and conditions in one place and lets the NF-e import fill the same row. Alternative: a separate `purchase_order` linked to `purchase` at receipt — rejected as two models for one thing.
2. **Existing rows migrate as `received`**, with `received_on = ordered_on` and `received_quantity = quantity`, so history and the analysis do not change.
3. **Facts are received only.** `summary()` and `SettlementService.propose()` filter `status = received` and use `received_on` (falling back to `ordered_on`) and `received_quantity`. Open orders get their own listing so they are visible without inflating "bought".
4. **Pure stage machine** (`utils/order-flow.ts`): allowed moves, requirements per move, no skip, nothing after received. The service only applies what the machine allows, inside a transaction that also writes the event row.
5. **Actors from the session.** The gateway sets `requested_by/sent_by/invoiced_by/received_by` from `caller.email` and overrides anything the client sent; domain services only store it (same pattern as `confirmed_by` in `drive-files.controller.ts`).
6. **Mail behind a port.** `MailTransport` with a nodemailer implementation (the only new dependency) and a fake for tests; SMTP settings validated at boot. Alternative: a transactional-mail API — rejected; the owner chose SMTP and it needs no new vendor.
7. **Send is a synchronous, confirmed action, not a queue job.** The operator waits for the result; a failure must be visible immediately and leave the stage unchanged. No retries behind their back: a retry is another explicit send. The send log is written whether it succeeds or fails.
8. **PDF in the browser.** The panel renders the order PDF with the existing renderer and posts it with the send request (size-limited); the HTML body already carries the full order, so the PDF is a complement. Alternative: a backend PDF library — rejected as a second renderer to maintain.
9. **Dev sends to a catcher** (Mailpit in the compose). Real credentials are set only by the owner; no real e-mail is sent during development or tests.
10. **Board without drag and drop**: columns plus the next-step button per card makes each step's requirements explicit (a number, quantities) and avoids accidental skips.

11. **Entry at any stage.** The creation call takes the initial stage; the stage machine validates the requirements of that stage, and the event log records "created at X". NF-e import and manual entry default to `invoiced` (the owner records after the invoice is issued) and show a one-click "Receber" (quantities default to what was ordered) plus "já recebi" at entry. Alternative: always start at requisition — rejected, it is not how the owner works.
12. **Order-level delivery and payment fields**: `expected_delivery_on`, `payment_term` (`on_receipt | due_date`), `payment_due_on`. Payment status stays per item as today; the pending-payments view reads paid-condition items of orders by `payment_due_on` (receipt date for `on_receipt`). Lateness and overdue are derived at read time (no stored flags).
13. **New product from the form** calls the existing products-service create (`POST /products`), then refreshes the selector; the optional reference cost uses the existing dated cost route with the purchase date. Permission follows products:write; no new backend capability.

## Risks / Trade-offs

- [Entering at `invoiced` and forgetting to receive hides the purchase from the analysis] → the board keeps it in "Aguardando recebimento" with a reminder after the expected delivery date, the receive button is one click, and "já recebi" is offered at entry.
- [A new product with no registered cost shows no margin] → the form offers to register the purchase cost as reference; otherwise the analysis keeps saying "Sem custo cadastrado".

- [Changing what "purchased" means] → existing purchases migrate as received, so numbers do not move; only new open orders are excluded.
- [A real e-mail is an outward, irreversible action] → preview, explicit confirm, no repeat without "send again", send log, and dev goes to a catcher.
- [A single supplier e-mail field] → recipient editable in the dialog, with an option to save it to the supplier; no CC list in this change.
- [Gmail SMTP quirks (app password, daily limits)] → configuration is the owner's; the transport is generic SMTP.
- [Receiving less than ordered] → the difference is recorded and shown; on-sale settlement uses the received quantity.

## Migration Plan

Additive columns and two tables in suppliers-service; a data migration sets existing purchases to `received`. Rollback: the stage column can be ignored (all rows read as received), and the mail module can be disabled by leaving SMTP unset (the send action reports "not configured").

## Open Questions

- Whether the payment term should also support instalments (several due dates for one order); assumed one due date per order.

- Receiving in parts: does a partial receipt close the order or keep a balance? Assumed: it closes at what was received, with the difference visible (no balance).
- Copy (CC) to the owner on each send: assumed no, one recipient.
- Text of the e-mail body (deadline, notes): assumed a short standard text plus the order's notes, editable in the preview.
