import { Injectable, Logger } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { PERIOD_EVENT_QUEUES, type PeriodDataUpdatedEvent } from '@app/period-events-contracts'

/**
 * Publishes "a store's period changed" after a sales ingestion.
 *
 * Added when the full chain was first exercised: only supply-service published,
 * so ingesting sales left inventory (and finance) holding a stale figure —
 * stock still showed 91 units after 40 had been sold, and nothing indicated it.
 * The event contract had always anticipated `source: 'sales'`; this is the other
 * half of it.
 *
 * Same rules as supply's publisher: identifiers only, after the transaction
 * commits, and only when something actually changed.
 */
@Injectable()
export class PeriodEventsPublisher {
  private readonly logger = new Logger(PeriodEventsPublisher.name)

  constructor(private readonly broker: HoldItBullMQBroker) {}

  async publishPeriodDataUpdated(storeId: number, period: string, correlationId?: string): Promise<void> {
    const event: PeriodDataUpdatedEvent = {
      schemaVersion: 1,
      storeId,
      period,
      source: 'sales',
      correlationId,
      changedAt: new Date().toISOString(),
    }

    await this.broker.holdIt({ queueName: PERIOD_EVENT_QUEUES.PERIOD_DATA_UPDATED, message: event })

    this.logger.log(`Published period-data-updated for store ${storeId} period ${period}`)
  }
}
