import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { DEFAULT_PARAMETERS, parameterMeta } from './parameters.defaults'
import type { DeepPartial, Parameters } from './parameters.types'
import { buildParameters } from './parameters.validation'

export interface ParameterVersionView {
  id: number
  createdAt: string
  note: string | null
  values: Parameters
  /** Every parameter with its provisional label, so a reader can tell the owner's rules from the starting guesses. */
  parameters: { path: string; value: unknown; provisional: boolean }[]
}

/**
 * Parameters are append-only (design D11): changing one creates a NEW version
 * built from the CURRENT one, validated as a whole; no version is ever edited
 * or deleted, so a result stored under version 3 can still be explained with
 * the values of version 3 after version 5 exists.
 */
@Injectable()
export class ParametersService implements OnModuleInit {
  private readonly logger = new Logger(ParametersService.name)

  constructor(private readonly prisma: PrismaClientService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureInitial()
  }

  /** Creates version 1 from the defaults when none exists. Idempotent. */
  async ensureInitial(): Promise<void> {
    if ((await this.prisma.parameterVersion.count()) > 0) return

    await this.prisma.parameterVersion.create({
      data: { note: 'initial defaults (provisional; tolerance 10% or 3 units as set by the owner)', values: DEFAULT_PARAMETERS as never },
    })
    this.logger.log('Created the initial parameter version')
  }

  async current(): Promise<ParameterVersionView> {
    const latest = await this.prisma.parameterVersion.findFirst({ orderBy: { id: 'desc' } })
    if (!latest) {
      await this.ensureInitial()
      return this.current()
    }

    return toView(latest)
  }

  async byId(id: number): Promise<ParameterVersionView> {
    const found = await this.prisma.parameterVersion.findUnique({ where: { id } })
    if (!found) throw new NotFoundException(`Parameter version ${id} not found`)

    return toView(found)
  }

  async list(): Promise<{ id: number; createdAt: string; note: string | null }[]> {
    const rows = await this.prisma.parameterVersion.findMany({ orderBy: { id: 'desc' }, select: { id: true, created_at: true, note: true } })

    return rows.map(row => ({ id: row.id, createdAt: row.created_at.toISOString(), note: row.note }))
  }

  /** Builds the next version from the current one plus `patch`; throws `ParametersInvalidError` listing every problem. */
  async createVersion(patch: DeepPartial<Parameters>, note?: string): Promise<ParameterVersionView> {
    const current = await this.current()
    const values = buildParameters(current.values, patch)

    const created = await this.prisma.parameterVersion.create({ data: { note: note ?? null, values: values as never } })

    return toView(created)
  }
}

function toView(row: { id: number; created_at: Date; note: string | null; values: unknown }): ParameterVersionView {
  const values = row.values as Parameters

  return { id: row.id, createdAt: row.created_at.toISOString(), note: row.note, values, parameters: parameterMeta(values) }
}
