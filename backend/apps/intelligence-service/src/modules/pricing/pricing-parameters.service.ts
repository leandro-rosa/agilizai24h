import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { DEFAULT_PRICING_PARAMETERS, mergePricingParameters, PricingParametersInvalidError, validatePricingParameters } from './pricing.parameters'
import type { PricingParameters } from './pricing.types'

export interface PricingParameterVersionView {
  id: number
  createdAt: string
  note: string | null
  values: PricingParameters
}

export type PricingParametersPatch = Parameters<typeof mergePricingParameters>[1]

/**
 * Append-only, like the mix parameters: a change creates a NEW version built
 * from the CURRENT one and validated as a whole; no version is edited or
 * deleted, so a result stored under version 3 can still be explained with the
 * values of version 3.
 */
@Injectable()
export class PricingParametersService implements OnModuleInit {
  private readonly logger = new Logger(PricingParametersService.name)

  constructor(private readonly prisma: PrismaClientService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureInitial()
  }

  async ensureInitial(): Promise<void> {
    if ((await this.prisma.pricingParameterVersion.count()) > 0) return

    await this.prisma.pricingParameterVersion.create({
      data: { note: 'initial defaults (35% target is the owner reference; tax rate unset until the owner confirms it)', values: DEFAULT_PRICING_PARAMETERS as never },
    })
    this.logger.log('Created the initial pricing parameter version')
  }

  async current(): Promise<PricingParameterVersionView> {
    const latest = await this.prisma.pricingParameterVersion.findFirst({ orderBy: { id: 'desc' } })
    if (!latest) {
      await this.ensureInitial()
      return this.current()
    }

    return toView(latest)
  }

  async byId(id: number): Promise<PricingParameterVersionView> {
    const found = await this.prisma.pricingParameterVersion.findUnique({ where: { id } })
    if (!found) throw new NotFoundException(`Pricing parameter version ${id} not found`)

    return toView(found)
  }

  async list(): Promise<{ id: number; createdAt: string; note: string | null }[]> {
    const rows = await this.prisma.pricingParameterVersion.findMany({ orderBy: { id: 'desc' }, select: { id: true, created_at: true, note: true } })

    return rows.map(row => ({ id: row.id, createdAt: row.created_at.toISOString(), note: row.note }))
  }

  /** Throws `PricingParametersInvalidError` listing every problem. */
  async createVersion(patch: PricingParametersPatch, note?: string): Promise<PricingParameterVersionView> {
    const current = await this.current()
    const values = mergePricingParameters(current.values, patch)
    const problems = validatePricingParameters(values)
    if (problems.length > 0) throw new PricingParametersInvalidError(problems)

    const created = await this.prisma.pricingParameterVersion.create({ data: { note: note ?? null, values: values as never } })

    return toView(created)
  }
}

/** A version stored before a parameter existed is read with the default filling the gap; the row is never touched. */
export function withPricingDefaults(stored: unknown): PricingParameters {
  const filled = structuredClone(DEFAULT_PRICING_PARAMETERS) as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries((stored ?? {}) as Record<string, unknown>)) {
    if (!(key in filled)) continue
    const base = filled[key]
    if (base !== null && typeof base === 'object' && !Array.isArray(base) && value !== null && typeof value === 'object') Object.assign(base, value)
    else filled[key] = value
  }

  return filled as unknown as PricingParameters
}

function toView(row: { id: number; created_at: Date; note: string | null; values: unknown }): PricingParameterVersionView {
  return { id: row.id, createdAt: row.created_at.toISOString(), note: row.note, values: withPricingDefaults(row.values) }
}
