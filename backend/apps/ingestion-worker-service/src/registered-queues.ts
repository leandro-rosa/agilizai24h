import { INGESTION_QUEUES } from '@app/ingestion-contracts'
import { TREASURY_QUEUES, TREASURY_SOURCE_QUEUES } from '@app/treasury-ingestion-contracts'
import { INTERNAL_QUEUES } from './modules/ingestion/constants/file-types'
import { DRIVE_QUEUES } from './modules/drive-source/constants/drive.constants'

/**
 * Every queue this service ever calls `broker.holdIt()`/`holdItALot()` on —
 * inbound (its own internal pipeline) or outbound (publishing to another
 * service). `HoldItBullMQBroker.holdIt()` resolves a BullMQ queue provider
 * by name from THIS list; a queue used anywhere in the codebase but missing
 * here fails at publish time with "Nest could not find BullQueue_<name>
 * element", not at compile time — see registered-queues.spec.ts, which
 * exists because exactly this happened: `SALES_TRANSACTIONS` was added to
 * `IngestionService.publishSalesTransactionsByStore` (add-sales-
 * transaction-detail) but not registered here, and every unit/integration
 * test stubs `HoldItBullMQBroker` directly, so nothing caught it short of
 * a real ingestion run. Kept in its own file, separate from `app.module.ts`,
 * so a test can import it without also triggering `ConfigModule.forRoot`'s
 * eager env validation.
 */
export const REGISTERED_QUEUES = [
  // Internal: file → chunks → staged rows.
  INTERNAL_QUEUES.PARSE_FILE,
  INTERNAL_QUEUES.STAGED_ROWS,
  // Internal: Google Drive source — scan, validate, import (add-drive-ingestion-source).
  ...Object.values(DRIVE_QUEUES),
  // Outbound: one batch per period to each owning service.
  INGESTION_QUEUES.SALES_ROWS,
  INGESTION_QUEUES.SALES_TRANSACTIONS,
  INGESTION_QUEUES.SUPPLY_ROWS,
  INGESTION_QUEUES.COST_ROWS,
  // Treasury: one inbound queue per source (this service's own fourth
  // sink family, add-treasury-statement-ingestion design D3), one
  // outbound queue to treasury-service regardless of which source
  // produced the rows.
  ...Object.values(TREASURY_SOURCE_QUEUES),
  TREASURY_QUEUES.RAW_ROWS,
]
