import type { PurchaseView } from '../services/purchases.service'
import { buildOrderEmail } from './order-email'

const order = (over: Partial<PurchaseView> = {}): PurchaseView =>
  ({
    id: 42,
    ordered_on: '2026-10-05',
    notes: null,
    expected_delivery_on: '2026-10-10',
    payment_term: 'due_date',
    payment_due_on: '2026-10-20',
    items: [
      { id: 1, sku: 'Q1', description: 'Wrap de quinoa', quantity: 100, unit_cost_cents: 800 },
      { id: 2, sku: 'Q2', description: null, quantity: 24, unit_cost_cents: 355 },
    ],
    ...over,
  }) as PurchaseView

describe('buildOrderEmail', () => {
  it('puts everything the supplier needs in the body: items, quantities, unit cost, total, deadline and payment', () => {
    const mail = buildOrderEmail(order())

    expect(mail.subject).toBe('Pedido de compra nº 42 — Agiliz.AI')
    expect(mail.text).toContain('Wrap de quinoa (Q1): 100 un. a')
    expect(mail.text).toMatch(/Total: .*885,20/)
    expect(mail.text).toContain('Prazo de entrega: 10/10/2026')
    expect(mail.text).toContain('Pagamento: boleto para 20/10/2026')
    expect(mail.html).toContain('<table')
    expect(mail.html).toContain('Wrap de quinoa')
  })

  it('says pay-on-receipt, and leaves out terms that were not given', () => {
    expect(buildOrderEmail(order({ payment_term: 'on_receipt', expected_delivery_on: null })).text).toContain('Pagamento: ao receber')
    const bare = buildOrderEmail(order({ payment_term: null, expected_delivery_on: null }))
    expect(bare.text).not.toContain('Pagamento')
    expect(bare.text).not.toContain('Prazo de entrega')
  })

  it('escapes what is typed into the message, the description and the notes', () => {
    const mail = buildOrderEmail(order({ notes: '<script>x</script>', items: [{ id: 1, sku: 'A&B', description: '<b>Pão</b>', quantity: 1, unit_cost_cents: 100 }] as never }), 'Oi <i>você</i>')

    expect(mail.html).not.toContain('<script>')
    expect(mail.html).not.toContain('<b>Pão</b>')
    expect(mail.html).toContain('&lt;b&gt;Pão&lt;/b&gt;')
    expect(mail.html).toContain('A&amp;B')
    expect(mail.html).toContain('Oi &lt;i&gt;você&lt;/i&gt;')
  })
})
