import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_SOURCE_QUEUES } from '@app/treasury-ingestion-contracts'
import { CreateTreasurySourceDto } from '../dto/create-treasury-source.dto'

/**
 * Internal API, called by the gateway once it has stored a raw file — same
 * division of labour as `POST /ingestions` for sales/supply/cost. Unlike
 * that endpoint, this one creates NO local record: treasury-service owns
 * every bit of state for what happens to a source file
 * (add-treasury-statement-ingestion design D4), so there is nothing to track
 * here beyond "queue the right parser".
 */
@ApiTags('treasury-ingestion')
@Controller('treasury-imports')
export class TreasuryIngestionController {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  @Post()
  @ApiOperation({
    summary: 'Queue a stored treasury source file for parsing',
    description: 'Returns immediately — parsing never happens on the request path.',
  })
  async create(@Body() dto: CreateTreasurySourceDto): Promise<{ queued: true }> {
    await this.broker.holdIt({
      queueName: TREASURY_SOURCE_QUEUES[dto.source],
      message: {
        objectKey: dto.object_key,
        accountId: dto.account_id,
        period: dto.period,
        correlationId: dto.correlation_id,
      },
      // Parsing depends on object storage; a transient blip must not
      // silently discard an upload. Bounded so a genuinely malformed file
      // still reaches a terminal failure — same policy as RETRY_OPTIONS in
      // ../../ingestion/constants/file-types.ts, duplicated here rather than
      // imported because this module has no other reason to depend on the
      // sales/supply/cost ingestion module.
      options: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    })

    return { queued: true }
  }
}
