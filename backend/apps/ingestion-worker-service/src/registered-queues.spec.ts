import { INGESTION_QUEUES } from '@app/ingestion-contracts'
import { REGISTERED_QUEUES } from './registered-queues'
import { DRIVE_QUEUES } from './modules/drive-source/constants/drive.constants'

/**
 * Guards against the exact bug add-sales-transaction-detail shipped with:
 * `IngestionService.publishSalesTransactionsByStore` called
 * `broker.holdIt({ queueName: INGESTION_QUEUES.SALES_TRANSACTIONS, ... })`,
 * but `SALES_TRANSACTIONS` was never added to `HoldItModule.register([...])`
 * in `app.module.ts`. Every unit and integration test stubs
 * `HoldItBullMQBroker` directly, so the missing registration only surfaced
 * running a real ingestion against the real broker — "Nest could not find
 * BullQueue_ingestion.sales-transactions element". This test would have
 * caught it without needing real infrastructure.
 */
describe('REGISTERED_QUEUES', () => {
  it('includes every queue in INGESTION_QUEUES — a queue this service can publish to must be resolvable', () => {
    for (const queueName of Object.values(INGESTION_QUEUES)) {
      expect(REGISTERED_QUEUES).toContain(queueName)
    }
  })

  it('includes the internal Drive queues — scan, validate and import are published with holdIt', () => {
    for (const queueName of Object.values(DRIVE_QUEUES)) {
      expect(REGISTERED_QUEUES).toContain(queueName)
    }
  })
})
