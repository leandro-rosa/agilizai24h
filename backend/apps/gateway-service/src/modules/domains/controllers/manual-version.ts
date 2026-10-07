import { BadRequestException } from '@nestjs/common'

/**
 * What a browser may say when it records a cost, a price or an EAN by hand. The origin and the user are NOT the
 * browser's to choose: the source is forced to `manual` and the actor is the logged-in user, so "who changed it" can
 * never be typed by the person it is about, and a client cannot pass itself off as an invoice, a pricing decision or a
 * purchase. Everything outside the allowed fields is dropped.
 */
const reasonOf = (body: Record<string, unknown>): string => {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) throw new BadRequestException('Informe o motivo da alteração')

  return reason
}

export function manualCost(body: Record<string, unknown> | undefined, actor: string): Record<string, unknown> {
  const input = body ?? {}

  return { effective_from: input.effective_from, cost_cents: input.cost_cents, source: 'manual', actor, reason: reasonOf(input) }
}

export function manualPrice(body: Record<string, unknown> | undefined, actor: string): Record<string, unknown> {
  const input = body ?? {}

  return { effective_from: input.effective_from, price_cents: input.price_cents, source: 'manual', actor, reason: reasonOf(input) }
}

/** An EAN linked by a person. No reason is required (it has a note), but the origin and the user are forced. */
export function manualEan(body: Record<string, unknown> | undefined, actor: string): Record<string, unknown> {
  const input = body ?? {}

  return { ean: input.ean, valid_from: input.valid_from, note: input.note, make_primary: input.make_primary, retire_current: input.retire_current, source: 'manual', actor }
}

/** Changing an EAN link: only these fields; there is no way to delete one. */
export function eanChange(body: Record<string, unknown> | undefined): Record<string, unknown> {
  const input = body ?? {}

  return { status: input.status, valid_to: input.valid_to, primary: input.primary, note: input.note }
}
