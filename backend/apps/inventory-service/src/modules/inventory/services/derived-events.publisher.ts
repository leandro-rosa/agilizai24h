import { Injectable, Logger } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { INVENTORY_PERIOD_DERIVED_SUBSCRIBERS, type InventoryPeriodDerivedEvent } from '@app/period-events-contracts'

/**
 * Announces that a period's stock has actually been derived.
 *
 * Published AFTER the rebuild transaction commits, so a consumer reading the
 * closing balance cannot see a half-rebuilt window — the whole reason
 * finance-service waits for this instead of reacting to the same input event.
 */
@Injectable()
export class DerivedEventsPublisher {
  private readonly logger = new Logger(DerivedEventsPublisher.name)

  constructor(private readonly broker: HoldItBullMQBroker) {}

  /** One event per rebuilt period: each has a new closing balance to revalue. */
  async publishPeriodsDerived(
    storeId: number,
    periods: string[],
    changedAt: string,
    correlationId?: string,
  ): Promise<void> {
    const events: InventoryPeriodDerivedEvent[] = periods.map(period => ({
      schemaVersion: 1,
      storeId,
      period,
      correlationId,
      // The original input-change time, carried through rather than reset —
      // otherwise a staleness marker downstream would only say when this
      // service happened to finish.
      changedAt,
    }))

    await Promise.all(
      events.flatMap(event =>
        // One publish per subscriber: BullMQ queues are point-to-point, so a
        // shared queue would hand each event to exactly one consumer.
        INVENTORY_PERIOD_DERIVED_SUBSCRIBERS.map(queueName => this.broker.holdIt({ queueName, message: event })),
      ),
    )

    this.logger.log(`Published inventory-period-derived for store ${storeId}: ${periods.join(', ')}`)
  }
}
