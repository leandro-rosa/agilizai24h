import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import type { AddCostDto, PutAgreementDto } from '../dto/consignment.dto'
import { validateCost, validatePeriodDays, type CostRow } from '../utils/consignment-agreement'
import { isDay } from '../utils/week'

export interface AgreementView {
  supplier_id: number
  period_days: number
  first_closing_on: string | null
  /** The only basis today: the agreed cost in force on the day of the sale. */
  cost_basis: 'sale_date'
}

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)
const date = (value: string) => new Date(`${value}T00:00:00Z`)

@Injectable()
export class ConsignmentAgreementService {
  constructor(private readonly prisma: PrismaClientService) {}

  async get(supplierId: number): Promise<{ agreement: AgreementView | null; costs: CostRow[] }> {
    const agreement = await this.prisma.consignmentAgreement.findUnique({ where: { supplier_id: supplierId } })
    const costs = await this.prisma.consignmentCost.findMany({ where: { supplier_id: supplierId }, orderBy: [{ sku: 'asc' }, { valid_from: 'asc' }] })

    return {
      agreement: agreement ? toAgreement(agreement) : null,
      costs: costs.map(c => ({ sku: c.sku, valid_from: day(c.valid_from) as string, unit_cost_cents: c.unit_cost_cents })),
    }
  }

  async put(supplierId: number, dto: PutAgreementDto): Promise<AgreementView> {
    const problem = validatePeriodDays(dto.period_days)
    if (problem) throw new BadRequestException(problem)
    if (dto.first_closing_on !== undefined && !isDay(dto.first_closing_on)) throw new BadRequestException('first_closing_on must be a real date, YYYY-MM-DD')
    await this.assertSupplier(supplierId)

    const first = dto.first_closing_on === undefined ? {} : { first_closing_on: date(dto.first_closing_on) }
    const saved = await this.prisma.consignmentAgreement.upsert({
      where: { supplier_id: supplierId },
      create: { supplier_id: supplierId, period_days: dto.period_days, ...first },
      update: { period_days: dto.period_days, ...first },
    })

    return toAgreement(saved)
  }

  /** A cost is never edited or removed: a correction is another vigência. */
  async addCost(supplierId: number, dto: AddCostDto): Promise<CostRow> {
    const problems = validateCost(dto)
    if (problems.length > 0) throw new BadRequestException(problems.join('; '))
    await this.assertSupplier(supplierId)

    try {
      const saved = await this.prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: dto.sku.trim(), valid_from: date(dto.valid_from), unit_cost_cents: dto.unit_cost_cents, note: dto.note } })

      return { sku: saved.sku, valid_from: day(saved.valid_from) as string, unit_cost_cents: saved.unit_cost_cents }
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException(`${dto.sku} already has a cost starting on ${dto.valid_from}: add a later vigência instead of changing it`)
      throw error
    }
  }

  private async assertSupplier(supplierId: number) {
    if (!(await this.prisma.supplier.findUnique({ where: { id: supplierId } }))) throw new NotFoundException(`Supplier ${supplierId} not found`)
  }
}

function toAgreement(row: { supplier_id: number; period_days: number; first_closing_on: Date | null }): AgreementView {
  return { supplier_id: row.supplier_id, period_days: row.period_days, first_closing_on: day(row.first_closing_on), cost_basis: 'sale_date' }
}
