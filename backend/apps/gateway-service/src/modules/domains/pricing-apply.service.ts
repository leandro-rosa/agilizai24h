import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { UpstreamStatusError } from '../upstream/upstream.client'
import { DomainClient } from '../upstream/domain.client'

export interface ApplyPriceInput {
  idempotencyKey?: unknown
  sku?: unknown
  newPriceCents?: unknown
  effectiveFrom?: unknown
  reason?: unknown
  runId?: unknown
  period?: unknown
  storeId?: unknown
}

interface Decision {
  id: string
  sku: string
  newPriceCents: number
  effectiveFrom: string
  /** The approving user, as recorded by the decision (set from the session). */
  actor: string
  reason: string | null
  status: string
}

export interface ApplyPriceResult {
  decision: Decision
  /** True when the price is now in force (the decision is `applied`). */
  applied: boolean
  /** The same request had already been applied: nothing was written again. */
  alreadyApplied: boolean
  warning?: string
}

const messageOf = (error: unknown): string => {
  if (error instanceof UpstreamStatusError) {
    const body = error.body as { message?: unknown } | undefined
    const detail = Array.isArray(body?.message) ? body.message.join('; ') : typeof body?.message === 'string' ? body.message : ''

    return `${error.service} respondeu ${error.status}${detail ? `: ${detail}` : ''}`
  }

  return error instanceof Error ? error.message : String(error)
}

/**
 * Applies a price across two services without a half-change nobody can see.
 *
 * 1. The decision is recorded in intelligence-service as `pending`, with the previous price and the recommendation
 *    taken there, never from the request.
 * 2. The price is written in products-service.
 * 3. The decision is closed as `applied`, or as `failed` with the reason if the write failed.
 *
 * It lives in the gateway, which holds the session, so the engine's "recommends, never acts" rule is untouched.
 * The same idempotency key is one decision and one write. Note that products-service replaces a version for the
 * same effective date, which is why the decision keeps the previous price.
 */
@Injectable()
export class PricingApplyService {
  private readonly logger = new Logger(PricingApplyService.name)

  constructor(private readonly domains: DomainClient) {}

  async apply(input: ApplyPriceInput, actor: string, correlationId?: string): Promise<ApplyPriceResult> {
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) throw new BadRequestException('idempotencyKey is required')

    const recorded = await this.domains.intelligence<{ created: boolean; decision: Decision }>({
      method: 'post',
      path: '/pricing/decisions',
      // The actor is the logged-in user and overrides whatever the client put in the body.
      payload: { ...input, actor },
      correlationId,
    })
    const decision = recorded.data.decision

    if (decision.status === 'applied') return { decision, applied: true, alreadyApplied: true }

    try {
      await this.domains.products({
        method: 'post',
        path: `/products/${encodeURIComponent(decision.sku)}/prices`,
        // The price carries where it came from: the pricing recommendation, who approved it, why, and the decision id as
        // the idempotency key, so a retried apply can never write the same price twice.
        payload: { effective_from: decision.effectiveFrom, price_cents: decision.newPriceCents, source: 'pricing_intelligence', actor: decision.actor, reason: decision.reason ?? undefined, source_ref: decision.id },
        correlationId,
      })
    } catch (error) {
      await this.close(decision.id, 'failed', { error: messageOf(error) }, correlationId)
      throw error
    }

    try {
      const closed = await this.domains.intelligence<Decision>({ method: 'post', path: `/pricing/decisions/${encodeURIComponent(decision.id)}/applied`, correlationId })

      return { decision: closed.data, applied: true, alreadyApplied: false }
    } catch (error) {
      // The price is in force but its record could not be closed. Say so: the pending-decisions read will list it.
      this.logger.error(`Price of ${decision.sku} written but decision ${decision.id} could not be closed: ${messageOf(error)}`)

      return { decision, applied: true, alreadyApplied: false, warning: 'O preço foi gravado, mas o registro da decisão não pôde ser concluído. Ele aparece como pendente.' }
    }
  }

  private async close(id: string, outcome: 'applied' | 'failed', payload: unknown, correlationId?: string): Promise<void> {
    try {
      await this.domains.intelligence({ method: 'post', path: `/pricing/decisions/${encodeURIComponent(id)}/${outcome}`, payload, correlationId })
    } catch (error) {
      // The original failure is what the caller must see; this one is logged and found by the pending read.
      this.logger.error(`Decision ${id} could not be closed as ${outcome}: ${messageOf(error)}`)
    }
  }
}
