import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { ProductsClient } from '../sources/products.client'
import { PricingRunsService } from './pricing-runs.service'
import type { PricingReport } from './pricing.service'
import { assertPrice, InvalidPriceError } from './simulate'

export interface RecordDecisionInput {
  idempotencyKey?: unknown
  sku?: unknown
  newPriceCents?: unknown
  /** 'YYYY-MM-DD'; defaults to today. */
  effectiveFrom?: unknown
  reason?: unknown
  /** The run the user was looking at when approving; the latest completed run of the scope when absent. */
  runId?: unknown
  period?: unknown
  storeId?: unknown
  /** Set by the gateway from the session; never typed by the person it is about. */
  actor?: unknown
  correlationId?: string
}

interface DecisionRow {
  id: string
  idempotency_key: string
  sku: string
  previous_price_cents: number | null
  new_price_cents: number
  effective_from: Date
  actor: string
  recommended_price_cents: number | null
  confidence: string | null
  run_id: string | null
  parameter_version_id: number | null
  reason: string | null
  status: string
  error: string | null
  created_at: Date
  updated_at: Date
}

export interface DecisionView {
  id: string
  sku: string
  previousPriceCents: number | null
  newPriceCents: number
  effectiveFrom: string
  actor: string
  recommendedPriceCents: number | null
  confidence: string | null
  runId: string | null
  parameterVersion: number | null
  reason: string | null
  status: string
  error: string | null
  createdAt: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const text = (value: unknown, name: string, max: number): string | null => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new BadRequestException(`${name} is too long`)

  return trimmed || null
}

const toView = (row: DecisionRow): DecisionView => ({
  id: row.id,
  sku: row.sku,
  previousPriceCents: row.previous_price_cents,
  newPriceCents: row.new_price_cents,
  effectiveFrom: row.effective_from.toISOString().slice(0, 10),
  actor: row.actor,
  recommendedPriceCents: row.recommended_price_cents,
  confidence: row.confidence,
  runId: row.run_id,
  parameterVersion: row.parameter_version_id,
  reason: row.reason,
  status: row.status,
  error: row.error,
  createdAt: row.created_at.toISOString(),
})

/**
 * The history of price decisions. It records and reads; it NEVER writes a price: the gateway does that between
 * `record` and `markApplied` / `markFailed`, so the engine's "recommends, never acts" rule still holds here.
 * The previous price and the recommendation are taken on the server, never from the request body.
 */
@Injectable()
export class PricingDecisionsService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly products: ProductsClient,
    private readonly runs: PricingRunsService,
  ) {}

  /** Records a pending decision. The same idempotency key returns the decision already recorded. */
  async record(input: RecordDecisionInput): Promise<{ created: boolean; decision: DecisionView }> {
    const key = text(input.idempotencyKey, 'idempotencyKey', 100)
    if (!key) throw new BadRequestException('idempotencyKey is required')
    const existing = await this.prisma.pricingDecision.findUnique({ where: { idempotency_key: key } })
    if (existing) return { created: false, decision: toView(existing as DecisionRow) }

    const sku = text(input.sku, 'sku', 80)
    if (!sku) throw new BadRequestException('sku is required')
    const actor = text(input.actor, 'actor', 200)
    if (!actor) throw new BadRequestException('actor is required')
    let newPriceCents: number
    try {
      newPriceCents = assertPrice(input.newPriceCents)
    } catch (error) {
      if (error instanceof InvalidPriceError) throw new BadRequestException(error.message.replace('priceCents', 'newPriceCents'))
      throw error
    }

    const today = new Date().toISOString().slice(0, 10)
    const effectiveFrom = input.effectiveFrom === undefined || input.effectiveFrom === null ? today : String(input.effectiveFrom)
    if (!DAY.test(effectiveFrom) || new Date(`${effectiveFrom}T00:00:00Z`).toISOString().slice(0, 10) !== effectiveFrom) {
      throw new BadRequestException('effectiveFrom must be a real date, YYYY-MM-DD')
    }

    const recommendation = await this.recommendationFor(sku, input)
    const reason = text(input.reason, 'reason', 500)
    // Approving exactly what the engine recommended needs no justification; anything else does.
    if (recommendation.priceCents !== newPriceCents && !reason) {
      throw new BadRequestException('reason is required when the new price differs from the recommendation')
    }

    const previous = await this.products.pricesAsOf([sku], today, input.correlationId)
    const previousPriceCents = previous.resolved[0]?.price_cents ?? null
    if (previous.unresolved.some(entry => entry.sku === sku && entry.reason === 'unknown_sku')) throw new NotFoundException(`Product ${sku} not found`)

    const created = await this.prisma.pricingDecision.create({
      data: {
        id: randomUUID(),
        idempotency_key: key,
        sku,
        previous_price_cents: previousPriceCents,
        new_price_cents: newPriceCents,
        effective_from: new Date(`${effectiveFrom}T00:00:00Z`),
        actor,
        recommended_price_cents: recommendation.priceCents,
        confidence: recommendation.confidence,
        run_id: recommendation.runId,
        parameter_version_id: recommendation.parameterVersion,
        reason,
        status: 'pending',
      },
    })

    return { created: true, decision: toView(created as DecisionRow) }
  }

  async markApplied(id: string): Promise<DecisionView> {
    return this.close(id, 'applied', null)
  }

  async markFailed(id: string, error: string): Promise<DecisionView> {
    return this.close(id, 'failed', error.slice(0, 500))
  }

  async list(input: { sku?: string; limit?: number }): Promise<DecisionView[]> {
    const rows = await this.prisma.pricingDecision.findMany({
      where: input.sku ? { sku: input.sku } : {},
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(input.limit ?? 50, 1), 200),
    })

    return rows.map(row => toView(row as DecisionRow))
  }

  /** Decisions still `pending` after `olderThanMinutes`: a price write that may have half-failed and needs a look. */
  async stalePending(olderThanMinutes = 5): Promise<DecisionView[]> {
    const rows = await this.prisma.pricingDecision.findMany({
      where: { status: 'pending', created_at: { lt: new Date(Date.now() - olderThanMinutes * 60_000) } },
      orderBy: { created_at: 'asc' },
    })

    return rows.map(row => toView(row as DecisionRow))
  }

  private async close(id: string, status: 'applied' | 'failed', error: string | null): Promise<DecisionView> {
    const row = await this.prisma.pricingDecision.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Decision ${id} not found`)
    // A closed decision is final: a late or repeated call must not rewrite what happened.
    if (row.status === 'applied' && status === 'failed') throw new ConflictException('Decision already applied')
    if (row.status === 'applied') return toView(row as DecisionRow)

    const updated = await this.prisma.pricingDecision.update({ where: { id }, data: { status, error } })

    return toView(updated as DecisionRow)
  }

  private async recommendationFor(sku: string, input: RecordDecisionInput): Promise<{ priceCents: number | null; confidence: string | null; runId: string | null; parameterVersion: number | null }> {
    const none = { priceCents: null, confidence: null, runId: null, parameterVersion: null }

    let report: PricingReport | null = null
    let runId: string | null = null
    let parameterVersion: number | null = null

    if (typeof input.runId === 'string' && input.runId) {
      const run = await this.runs.getWithReport(input.runId)
      if (run?.report) {
        report = run.report
        runId = run.view.id
        parameterVersion = run.view.parameterVersion
      }
    } else {
      const latest = await this.runs.latest({ period: typeof input.period === 'string' ? input.period : undefined, storeId: typeof input.storeId === 'number' ? input.storeId : undefined })
      if (latest.report && latest.run) {
        report = latest.report
        runId = latest.run.id
        parameterVersion = latest.run.parameterVersion
      }
    }

    const product = report?.products.find(candidate => candidate.sku === sku)
    if (!product) return none

    return { priceCents: product.recommendedPriceCents, confidence: product.confidence, runId, parameterVersion }
  }
}
