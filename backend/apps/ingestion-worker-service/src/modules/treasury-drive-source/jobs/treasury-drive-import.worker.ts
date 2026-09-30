import { Inject } from '@nestjs/common'
import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import type { DriveConfig } from '../../drive-source/config/drive.config'
import { DisabledDriveClient } from '../../drive-source/services/disabled-drive.client'
import { createGoogleDriveClient } from '../../drive-source/services/google-drive.client'
import { TREASURY_DRIVE_CONFIG, type TreasuryDriveConfig } from '../config/treasury-drive.config'
import { TREASURY_DRIVE_QUEUES } from '../constants/treasury-drive.constants'
import { TreasuryDriveImportService } from '../services/treasury-drive-import.service'

/**
 * Envelope for a confirmed treasury Drive import. Unlike the sales/abastecimento Drive
 * source's own `DriveImportPayload` (just a `fileId`, since that flow stores the confirmed
 * type/period on the row itself via `requestImport`), `TreasuryDriveFile` has no equivalent
 * `import_*` columns — the operator's confirmed `accountId`/`period` travel in the job itself.
 */
export interface TreasuryDriveImportJobEnvelope {
  schemaVersion: 1
  fileId: string
  accountId: number
  period: string
  correlationId?: string
}

/**
 * Runs one confirmed treasury Drive import. Same shape as `TreasuryDriveScanWorker` (Task 8):
 * this module passes the `DriveClient` into the service as a call argument rather than
 * injecting it via `DriveImportService`'s own constructor-DI token, so the worker builds it
 * fresh from config here, same as the scan worker already does.
 *
 * `concurrency: 1`, same as `drive-import.worker.ts`'s own queue: each import holds a whole
 * spreadsheet in memory and does one S3 upload. The repository's `claimForImporting` is the
 * real (atomic, DB-level) defense against two simultaneous imports of the SAME file — but it
 * runs on the REQUEST path now (`TreasuryDriveImportService.requestImport`), before a job is
 * ever enqueued here, not in this worker (see that service's own doc comment). This
 * `concurrency: 1` only caps how many DIFFERENT files this worker processes at once, the same
 * resource-use reasoning the sibling worker's own comment gives.
 */
@HoldItProcessor(TREASURY_DRIVE_QUEUES.IMPORT, { concurrency: 1 })
export class TreasuryDriveImportWorker extends HoldItWorkerHost<TreasuryDriveImportJobEnvelope> {
  constructor(
    @Inject(TREASURY_DRIVE_CONFIG) private readonly config: TreasuryDriveConfig,
    private readonly imports: TreasuryDriveImportService,
  ) {
    super()
  }

  async process(job: Job<TreasuryDriveImportJobEnvelope>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) {
      throw new Error(`Unsupported treasury Drive import job schemaVersion ${job.data.schemaVersion} on job ${job.id}`)
    }

    const client = this.config.enabled && this.config.credential
      ? createGoogleDriveClient({ credential: this.config.credential } as DriveConfig)
      : new DisabledDriveClient()

    return this.imports.runImport(job.data.fileId, client, job.data.accountId, job.data.period)
  }
}
