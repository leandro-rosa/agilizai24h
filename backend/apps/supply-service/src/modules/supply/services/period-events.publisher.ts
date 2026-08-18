import { Injectable, Logger } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { PERIOD_DATA_UPDATED_SUBSCRIBERS, type PeriodDataUpdatedEvent } from '@app/period-events-contracts'

/**
 * Publishes "a store's period changed" so downstream reconciliation recomputes
 * without this service knowing how reconciliation works.
 *
 * Published only AFTER the replacement transaction commits, so no consumer can
 * read a half-replaced period — and only when something actually changed.
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
      source: 'supply',
      correlationId,
      changedAt: new Date().toISOString(),
    }

    // One publish per subscriber: BullMQ queues are point-to-point, so a single
    // shared queue would deliver each event to exactly one consumer.
    // Identifiers only — deliberately no loss totals or monetary values. The
    // consumer reads current state when it processes this.
    await Promise.all(
      PERIOD_DATA_UPDATED_SUBSCRIBERS.map(queueName => this.broker.holdIt({ queueName, message: event })),
    )

    this.logger.log(`Published period-data-updated for store ${storeId} period ${period}`)
  }
}
