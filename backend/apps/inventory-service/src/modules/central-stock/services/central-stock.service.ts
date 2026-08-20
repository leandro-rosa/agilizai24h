import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import type { CreateLotDto, ListLotsDto, UpdateLotDto } from '../dto/central-stock.dto'

export interface CentralStockSummary {
  lot_count: number
  total_quantity: number
  expired_quantity: number
  expiring_30d_quantity: number
  /// Valor parado no CD, em centavos. Só conta lote com custo informado — e
  /// `valued_lot_count` diz sobre quantos, para a cifra não passar por
  /// completa quando não é.
  valued_amount_cents: number
  valued_lot_count: number
}

@Injectable()
export class CentralStockService {
  constructor(private readonly prisma: PrismaClientService) {}

  list(filter: ListLotsDto = {}) {
    const where: Record<string, unknown> = {}
    if (filter.sku) where.sku = filter.sku

    if (filter.expiring_within_days !== undefined) {
      const limit = new Date()
      limit.setUTCDate(limit.getUTCDate() + filter.expiring_within_days)
      // Inclui o já vencido de propósito: quem pergunta "o que vence em 30
      // dias" precisa ver primeiro o que já venceu e continua no estoque.
      where.expires_on = { not: null, lte: limit }
    }

    return this.prisma.centralStockLot.findMany({
      where,
      // Vencimento mais próximo primeiro; lote sem validade por último, porque
      // não é o que precisa de decisão.
      orderBy: [{ expires_on: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    })
  }

  async findById(id: number) {
    const lot = await this.prisma.centralStockLot.findUnique({ where: { id } })
    if (!lot) throw new NotFoundException(`Lot ${id} not found`)

    return lot
  }

  create(dto: CreateLotDto) {
    return this.prisma.centralStockLot.create({
      data: {
        ...dto,
        received_on: new Date(dto.received_on),
        expires_on: dto.expires_on ? new Date(dto.expires_on) : null,
      },
    })
  }

  async update(id: number, dto: UpdateLotDto) {
    await this.findById(id)

    return this.prisma.centralStockLot.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.received_on ? { received_on: new Date(dto.received_on) } : {}),
        ...(dto.expires_on !== undefined ? { expires_on: dto.expires_on ? new Date(dto.expires_on) : null } : {}),
      },
    })
  }

  async remove(id: number): Promise<void> {
    await this.findById(id)

    await this.prisma.centralStockLot.delete({ where: { id } })
  }

  /** Estoque parado no CD e o que está prestes a virar perda. */
  async summary(reference = new Date()): Promise<CentralStockSummary> {
    const lots = await this.prisma.centralStockLot.findMany({
      select: { quantity: true, expires_on: true, unit_cost_cents: true },
    })

    const in30 = new Date(reference)
    in30.setUTCDate(in30.getUTCDate() + 30)

    let total = 0
    let expired = 0
    let expiring = 0
    let valued = 0
    let valuedLots = 0

    for (const lot of lots) {
      total += lot.quantity

      if (lot.expires_on) {
        if (lot.expires_on < reference) expired += lot.quantity
        else if (lot.expires_on <= in30) expiring += lot.quantity
      }

      if (lot.unit_cost_cents !== null) {
        valued += lot.unit_cost_cents * lot.quantity
        valuedLots += 1
      }
    }

    return {
      lot_count: lots.length,
      total_quantity: total,
      expired_quantity: expired,
      expiring_30d_quantity: expiring,
      valued_amount_cents: valued,
      valued_lot_count: valuedLots,
    }
  }
}
