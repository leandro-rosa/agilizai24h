## 1. Model and stage rules

- [x] 1.1 Schema and migration: stage, actors, timestamps, received quantity, event log, e-mail log; existing purchases become `received`
- [x] 1.2 Pure stage machine (`order-flow.ts`) with specs: allowed moves, requirements per move, no skip, final after received
- [x] 1.3 Service: create requisition, move stage with the event row in one transaction, record received quantities and differences
- [x] 1.4 Only received orders count: `summary()` and the settlement use `received_on` and `received_quantity`; list open orders separately
- [x] 1.5 Routes and tests (fakes), and the throwaway-database integration spec extended

- [x] 1.6 Entry at any stage: creation takes the initial stage; requirements per stage; event "created at X"; tests
- [x] 1.7 Delivery deadline and payment term fields; due date from the receipt for `on_receipt`; derived late and overdue flags
- [x] 1.8 Pending-payments listing by due date with totals (paid-condition items only)

## 2. Gateway

- [x] 2.1 `/purchase-orders/*` routes that set the actor from the session and ignore a client-sent actor
- [x] 2.2 Permission and forwarding tests

## 3. E-mail

- [x] 3.1 `MailTransport` port, nodemailer implementation, SMTP env validated at boot, lockfile updated
- [x] 3.2 Preview endpoint: recipient (editable), subject, HTML body, attachment info
- [x] 3.3 Send endpoint: explicit confirmation, no resend without the flag, log on success and failure, stage moves only on success
- [x] 3.4 Mail catcher in the dev compose; tests with the fake transport (failure keeps the stage; second send refused)

## 4. Admin

- [x] 4.1 Orders board with five columns, cards and next-step buttons; list view kept
- [x] 4.2 New-requisition form reusing the purchase form
- [x] 4.3 Send dialog: preview, editable recipient with save-to-supplier option, PDF generated in the browser, confirm
- [ ] 4.4 Invoicing step (number or NF-e import) and receiving step (received quantities, difference highlighted)
- [x] 4.5 Entry stage selector (default invoiced with a number or NF-e), "já recebi", delivery date and payment term in the forms; late and overdue badges on cards and list
- [x] 4.6 Pending payments view by due date
- [x] 4.7 Register a new product from the requisition, manual and import forms (selectable at once; optional reference cost)
- [x] 4.8 Component specs; docs in the CLAUDE.md files

## 5. Verification

- [ ] 5.1 End to end on the dev stack with the mail catcher: requisition, send, invoice, receive; check the e-mail and the analysis (no test data in the real database)
- [ ] 5.2 Owner configures real SMTP and approves the first real send
- [x] 5.3 Commit, merge and push in the same session
