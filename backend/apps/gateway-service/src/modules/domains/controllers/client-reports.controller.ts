import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { PERMISSIONS } from '@app/iam-contracts'
import type { FastifyRequest } from 'fastify'
import { RequiresPermission } from '../../auth/guards/session.constants'
import { ClientDivergenceReportService } from '../client-divergence-report.service'
import { correlationOf } from './stores.controller'

@ApiTags('client-reports')
@Controller('client-reports')
export class ClientReportsController {
  constructor(private readonly reports: ClientDivergenceReportService) {}

  @Get('divergences')
  @RequiresPermission(PERMISSIONS.SUPPLY_READ)
  @ApiOperation({
    summary: 'Stock divergences of one client, per unit and visit, valued at the sale price of the day they were identified',
    description:
      'Read-only. Only the "Outro motivo" removals (the internal "Outros (roubo)"). Units are the client billing sites; a store that is not one of them is refused. ' +
      'The dates are the report visits\' own instants; the price is null (never zero) where none was registered on or before that day.',
  })
  @ApiQuery({ name: 'client_id', required: true })
  @ApiQuery({ name: 'store_ids', required: false, description: 'Comma-separated; omitted = every unit of the client' })
  @ApiQuery({ name: 'from', required: true, example: '2026-05-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-05-11' })
  divergences(@Query('client_id') clientId: string, @Query('store_ids') storeIds: string | undefined, @Query('from') from: string, @Query('to') to: string, @Req() request: FastifyRequest) {
    const ids = (storeIds ?? '').split(',').filter(Boolean).map(Number)
    if (ids.some(id => !Number.isInteger(id) || id <= 0)) throw new BadRequestException('store_ids must be positive integers')

    return this.reports.build({ clientId: Number(clientId), storeIds: ids, from, to, correlationId: correlationOf(request) })
  }
}
