import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaClientService } from '../db-client/prisma-client.service'
import { ParametersService } from '../parameters/parameters.service'
import { isValidWeekdays } from '../parameters/parameters.validation'

export interface StoreScheduleView {
  storeId: number
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[]
  /** 'default' when the store has no override of its own. */
  source: 'default' | 'override'
}

/**
 * The planned visit weekdays of a store: its own override when it has one, the
 * default of the current parameters otherwise. Never inferred from history —
 * the owner states them (Monday, Tuesday, Thursday and Friday, with sporadic
 * changes). Overrides are append-only; the latest row of a store wins.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly parameters: ParametersService,
  ) {}

  async weekdaysFor(storeId: number): Promise<StoreScheduleView> {
    const override = await this.prisma.storeSchedule.findFirst({ where: { store_id: storeId }, orderBy: { id: 'desc' } })
    if (override) return { storeId, weekdays: override.weekdays, source: 'override' }

    const current = await this.parameters.current()
    return { storeId, weekdays: current.values.schedule.visitWeekdays, source: 'default' }
  }

  async setOverride(storeId: number, weekdays: number[], note?: string): Promise<StoreScheduleView> {
    if (!isValidWeekdays(weekdays)) {
      throw new BadRequestException('weekdays must be a non-empty list of distinct ISO weekdays, 1 (Monday) to 7 (Sunday)')
    }

    await this.prisma.storeSchedule.create({ data: { store_id: storeId, weekdays: [...weekdays].sort((a, b) => a - b), note: note ?? null } })

    return this.weekdaysFor(storeId)
  }
}
