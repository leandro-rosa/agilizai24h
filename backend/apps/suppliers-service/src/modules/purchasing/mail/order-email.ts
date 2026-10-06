import type { PurchaseView } from '../services/purchases.service'

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const cents = (value: number) => brl.format(value / 100)
const date = (day: string | null) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : null)

export const DEFAULT_MESSAGE = 'Olá! Segue o nosso pedido de compra. Por favor, confirme o recebimento e o prazo de entrega.'

export interface OrderEmail {
  subject: string
  text: string
  html: string
}

/**
 * The e-mail for an order: a short message, then the items with quantity and the agreed cost per unit, the delivery deadline,
 * the payment term and the notes. Everything the supplier needs is IN the body — the PDF is only a complement. Every value is escaped.
 */
export function buildOrderEmail(order: PurchaseView, message: string = DEFAULT_MESSAGE): OrderEmail {
  const subject = `Pedido de compra nº ${order.id} — Agiliz.AI`
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unit_cost_cents, 0)
  const terms = [
    order.expected_delivery_on ? `Prazo de entrega: ${date(order.expected_delivery_on)}` : null,
    order.payment_term === 'on_receipt' ? 'Pagamento: ao receber' : order.payment_term === 'due_date' && order.payment_due_on ? `Pagamento: boleto para ${date(order.payment_due_on)}` : null,
  ].filter((line): line is string => line !== null)

  const textLines = [
    message,
    '',
    `Pedido nº ${order.id} — ${date(order.ordered_on)}`,
    ...order.items.map(item => `- ${item.description ?? item.sku} (${item.sku}): ${item.quantity} un. a ${cents(item.unit_cost_cents)} = ${cents(item.quantity * item.unit_cost_cents)}`),
    `Total: ${cents(total)}`,
    ...terms,
    ...(order.notes ? ['', `Observações: ${order.notes}`] : []),
    '',
    'Agiliz.AI',
  ]

  const rows = order.items
    .map(
      item =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd">${escapeHtml(item.description ?? item.sku)}<br><small>${escapeHtml(item.sku)}</small></td>` +
        `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${item.quantity}</td>` +
        `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${cents(item.unit_cost_cents)}</td>` +
        `<td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${cents(item.quantity * item.unit_cost_cents)}</td></tr>`,
    )
    .join('')

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
    `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` +
    `<p><strong>Pedido nº ${order.id}</strong> — ${date(order.ordered_on)}</p>` +
    `<table style="border-collapse:collapse"><thead><tr>` +
    `<th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Produto</th><th style="padding:4px 8px;border:1px solid #ddd">Qtd.</th>` +
    `<th style="padding:4px 8px;border:1px solid #ddd">Custo un.</th><th style="padding:4px 8px;border:1px solid #ddd">Total</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<p><strong>Total: ${cents(total)}</strong></p>` +
    (terms.length > 0 ? `<p>${terms.map(escapeHtml).join('<br>')}</p>` : '') +
    (order.notes ? `<p>Observações: ${escapeHtml(order.notes)}</p>` : '') +
    `<p>Agiliz.AI</p></div>`

  return { subject, text: textLines.join('\n'), html }
}
