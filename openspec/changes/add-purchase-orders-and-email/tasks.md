## 1. Model and stage rules

- [ ] 1.1 Schema and migration: stage, actors, timestamps, received quantity, event log, e-mail log; existing purchases become `received`
- [ ] 1.2 Pure stage machine (`order-flow.ts`) with specs: allowed moves, requirements per move, no skip, final after received
- [ ] 1.3 Service: create requisition, move stage with the event row in one transaction, record received quantities and differences
- [ ] 1.4 Only received orders count: `summary()` and the settlement use `received_on` and `received_quantity`; list open orders separately
- [ ] 1.5 Routes and tests (fakes), and the throwaway-database integration spec extended

## 2. Gateway

- [ ] 2.1 `/purchase-orders/*` routes that set the actor from the session and ignore a client-sent actor
- [ ] 2.2 Permission and forwarding tests

## 3. E-mail

- [ ] 3.1 `MailTransport` port, nodemailer implementation, SMTP env validated at boot, lockfile updated
- [ ] 3.2 Preview endpoint: recipient (editable), subject, HTML body, attachment info
- [ ] 3.3 Send endpoint: explicit confirmation, no resend without the flag, log on success and failure, stage moves only on success
- [ ] 3.4 Mail catcher in the dev compose; tests with the fake transport (failure keeps the stage; second send refused)

## 4. Admin

- [ ] 4.1 Orders board with five columns, cards and next-step buttons; list view kept
- [ ] 4.2 New-requisition form reusing the purchase form
- [ ] 4.3 Send dialog: preview, editable recipient with save-to-supplier option, PDF generated in the browser, confirm
- [ ] 4.4 Invoicing step (number or NF-e import) and receiving step (received quantities, difference highlighted)
- [ ] 4.5 Component specs; docs in the CLAUDE.md files

## 5. Verification

- [ ] 5.1 End to end on the dev stack with the mail catcher: requisition, send, invoice, receive; check the e-mail and the analysis (no test data in the real database)
- [ ] 5.2 Owner configures real SMTP and approves the first real send
- [ ] 5.3 Commit, merge and push in the same session
