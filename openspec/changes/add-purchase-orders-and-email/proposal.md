## Why

Purchases are only recorded after the fact (an imported NF-e or a manual entry). The owner works orders in stages in the system used today (Gestão de Compras): requisition, waiting for invoicing, invoiced, waiting for receipt, received, with one card per order and the requisition sent to the supplier by e-mail. Without it the panel cannot show what is ordered but not yet received, who did what, or send an order, and "purchased" cannot mean "received".

## What Changes

- Purchases become **orders with five stages**: `requisition` → `awaiting_invoice` → `invoiced` → `awaiting_receipt` → `received`. Existing purchases migrate as `received` (they are facts).
- Every order records **who** created, sent, invoiced and received it, and a **history of each stage change**.
- **Only received orders count** as purchases: the analysis, the weekly settlement of on-sale items and the purchase base use received orders, dated by the receipt. Open orders are shown as information ("pedido em aberto"), never as bought.
- Receiving records the **quantity actually received per item** (default: the quantity ordered); the difference stays visible.
- A requisition can be **sent to the supplier by e-mail from the panel** (SMTP): the operator sees a preview (recipient, subject, body, PDF attachment) and sends only by explicit confirmation. No approval step: whoever creates may send. A failed send leaves the order where it was and is recorded; a repeated send needs an explicit "send again".
- **Entering at any stage.** Orders are often recorded only after the order was placed and the invoice issued, so a purchase can be entered directly at `awaiting_invoice`, `invoiced`, `awaiting_receipt` or `received` (a requisition is optional). Importing an NF-e or entering one by hand starts at `invoiced`, with a one-click "Receber" and an option "já recebi".
- **Delivery deadline and payment date.** Each order carries an expected delivery date (prazo de entrega) and a payment term: pay on receipt, or a due date (boleto for day X). The board and the list show both, flag late deliveries and overdue payments, and show what is to be paid and when.
- **New products from the form.** A product not yet in the catalogue can be registered without leaving the purchase, requisition or NF-e import form, and is selectable at once; the purchase cost can optionally be registered as the product's reference cost.
- Admin: the orders page becomes a **five-column board** (buttons for the next stage, no drag and drop), with the current list as an alternative view.

## Capabilities

### New Capabilities
- `purchase-order-email`: preview and sending of an order to the supplier by e-mail, with the send log.

### Modified Capabilities
- `purchasing`: order stages, actors, history, received quantities; only received orders count as purchases.
- `purchase-settlement`: "delivered" for on-sale items means received.
- `web-admin`: the orders board, the requisition form, the send dialog, invoicing and receiving steps.

## Impact

- `backend/apps/suppliers-service`: schema and migration (status, actors, received quantities, event log, e-mail log), transition rules, mail module (one new dependency: a mail library, lockfile updated), SMTP settings.
- `backend/apps/gateway-service`: `/purchase-orders/*` routes that add the logged-in user as the actor.
- `backend/apps/intelligence-service`: no contract change; it sees only received orders through the existing summary.
- `frontend/apps/admin`: board, forms and dialogs; order PDF generated in the browser (same renderer as the monthly summary).
- Dev stack: a local mail catcher so sending can be verified without real e-mail. Real SMTP credentials are configured only with the owner's explicit approval.
