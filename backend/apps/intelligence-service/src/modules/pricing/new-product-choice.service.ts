import { BadRequestException, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { PricingService } from './pricing.service'
import { assertPrice, InvalidPriceError } from './simulate'

export const NEW_PRODUCT_CHOICES = ['suggested_accepted', 'changed_by_hand', 'left_without_price'] as const
export type NewProductChoice = (typeof NEW_PRODUCT_CHOICES)[number]

export interface RecordChoiceInput {
  idempotencyKey?: unknown
  sku?: unknown
  choice?: unknown
  chosenPriceCents?: unknown
  /** The pricing decision that wrote the price (the gateway records the decision first). */
  decisionId?: unknown
  reason?: unknown
  costCents?: unknown
  costOrigin?: unknown
  costNotReceived?: unknown
  /** Set by the gateway from the session. */
  actor?: unknown
  correlationId?: string
}

const text = (value: unknown, name: string, max: number): string | null => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new BadRequestException(`${name} is too long`)

  return trimmed || null
}

/**
 * The audit of what was chosen for a new product's price. The suggestion is recomputed HERE, on the server, at the moment of the
 * choice, so what is stored is what the engine said then, never a number the browser typed as "the suggestion". It records; it never writes a price.
 */
@Injectable()
export class NewProductChoiceService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly pricing: PricingService,
  ) {}

  async record(input: RecordChoiceInput) {
    const key = text(input.idempotencyKey, 'idempotencyKey', 100)
    if (!key) throw new BadRequestException('idempotencyKey is required')
    const existing = await this.prisma.newProductPriceChoice.findUnique({ where: { idempotency_key: key } })
    if (existing) return { created: false, choice: existing }

    const sku = text(input.sku, 'sku', 80)
    if (!sku) throw new BadRequestException('sku is required')
    const actor = text(input.actor, 'actor', 200)
    if (!actor) throw new BadRequestException('actor is required')
    if (!(NEW_PRODUCT_CHOICES as readonly unknown[]).includes(input.choice)) throw new BadRequestException(`choice must be one of: ${NEW_PRODUCT_CHOICES.join(', ')}`)
    const choice = input.choice as NewProductChoice
    const reason = text(input.reason, 'reason', 500)

    let chosen: number | null = null
    if (choice !== 'left_without_price') {
      try {
        chosen = assertPrice(input.chosenPriceCents)
      } catch (error) {
        if (error instanceof InvalidPriceError) throw new BadRequestException(error.message.replace('priceCents', 'chosenPriceCents'))
        throw error
      }
    } else if (input.chosenPriceCents !== undefined && input.chosenPriceCents !== null) {
      throw new BadRequestException('A product left without a price has no chosen price')
    }

    const costCents = typeof input.costCents === 'number' && Number.isInteger(input.costCents) && input.costCents > 0 ? input.costCents : undefined
    const costNotReceived = input.costNotReceived === true
    const { meta, suggestion } = await this.pricing.newProduct(sku, { costCents, costOrigin: text(input.costOrigin, 'costOrigin', 200) ?? undefined, costNotReceived }, input.correlationId)

    if (choice === 'suggested_accepted' && chosen !== suggestion.suggestedPriceCents) {
      throw new BadRequestException(suggestion.suggestedPriceCents === null ? 'There is no suggested price to accept' : 'The price differs from the suggestion: record it as changed by hand, with a reason')
    }
    if (choice === 'changed_by_hand' && !reason) throw new BadRequestException('reason is required when the price is typed by hand')

    const created = await this.prisma.newProductPriceChoice.create({
      data: {
        id: randomUUID(),
        idempotency_key: key,
        sku,
        choice,
        suggested_price_cents: suggestion.suggestedPriceCents,
        confidence: suggestion.confidence,
        parameter_version_id: meta.parameterVersion,
        chosen_price_cents: chosen,
        decision_id: text(input.decisionId, 'decisionId', 100),
        reason,
        actor,
        cost_cents: costCents ?? null,
        cost_origin: text(input.costOrigin, 'costOrigin', 200),
        cost_not_received: costNotReceived,
        data_used: suggestion.dataUsed as never,
      },
    })

    return { created: true, choice: created }
  }

  async list(sku: string) {
    return this.prisma.newProductPriceChoice.findMany({ where: { sku }, orderBy: { created_at: 'desc' }, take: 50 })
  }
}
