import { Injectable } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_DRIVE_QUEUES } from '../constants/treasury-drive.constants'
import type { TreasuryDriveImportJobEnvelope } from '../jobs/treasury-drive-import.worker'
import type { TreasuryDriveScanJobEnvelope } from '../jobs/treasury-drive-scan.worker'

export type EnqueueScanResult = 'queued' | 'already_running'

export type TreasuryDriveScanPayload = Omit<TreasuryDriveScanJobEnvelope, 'schemaVersion'>
export type TreasuryDriveImportPayload = Omit<TreasuryDriveImportJobEnvelope, 'schemaVersion'>

/** The only place that puts treasury Drive jobs on the queues. Mirrors `DriveProducer` (the
 * sibling sales/abastecimento Drive source's own producer) exactly — same de-duplication
 * reasoning, just targeting `TREASURY_DRIVE_QUEUES` instead of `DRIVE_QUEUES`, and a flat job
 * envelope (`{ schemaVersion, ...fields }`) instead of a generic `{ schemaVersion, payload }`
 * wrapper, because that's the envelope shape `TreasuryDriveScanWorker`/`TreasuryDriveImportWorker`
 * (Tasks 8–9) already declared for themselves. */
@Injectable()
export class TreasuryDriveProducer {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  /**
   * Queues a manual scan unless one is already waiting or active, so two clicks on
   * "Sincronizar agora" collapse into one run — copied verbatim from `DriveProducer.enqueueScan`'s
   * own reasoning:
   *
   * It deliberately does NOT use a fixed `jobId` to deduplicate: hold-it retains a completed job
   * for two hours and BullMQ ignores a job added under an id it still retains, which would
   * silently make the button do nothing for two hours. It also looks only at `waiting` and
   * `active`, never `delayed`: once Task 11's scheduler exists it will keep the NEXT daily scan
   * in the queue as a delayed job, and counting that would block manual syncs forever.
   */
  // `_correlationId` accepted only for call-site symmetry with the sibling producer's
  // enqueueScan(payload, correlationId) — TreasuryDriveScanJobEnvelope carries no such field.
  async enqueueScan(payload: TreasuryDriveScanPayload, _correlationId?: string): Promise<EnqueueScanResult> {
    const queue = await this.broker.getQueue(TREASURY_DRIVE_QUEUES.SCAN)
    const inFlight = await queue.getJobs(['waiting', 'active'])

    if (inFlight.length > 0) return 'already_running'

    const message: TreasuryDriveScanJobEnvelope = { schemaVersion: 1, trigger: payload.trigger }

    await this.broker.holdIt({
      queueName: TREASURY_DRIVE_QUEUES.SCAN,
      message,
      options: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
    })

    return 'queued'
  }

  /**
   * One import job per call, with a timestamp-suffixed `jobId` — same as `DriveProducer.enqueueImport`
   * — never a fixed one: two different confirmed imports of the same file (e.g. a retry after
   * `error`) must both be able to queue, unlike `enqueueValidation`'s "one at a time" dedup, which
   * this module has no equivalent of (no `:id/validate` route — see the controller's own doc
   * comment). The real "only one import of this file at a time" guarantee is
   * `TreasuryDriveRepository.claimForImporting`'s atomic DB-level claim — but that runs on the
   * REQUEST path, inside `TreasuryDriveImportService.requestImport`, BEFORE this method is ever
   * called: by the time a job reaches this queue, the claim has already succeeded, so nothing
   * enforced here needs to duplicate it.
   */
  async enqueueImport(payload: TreasuryDriveImportPayload, correlationId?: string): Promise<void> {
    const message: TreasuryDriveImportJobEnvelope = {
      schemaVersion: 1,
      fileId: payload.fileId,
      accountId: payload.accountId,
      period: payload.period,
      correlationId: payload.correlationId ?? correlationId,
    }

    await this.broker.holdIt({
      queueName: TREASURY_DRIVE_QUEUES.IMPORT,
      message,
      options: {
        jobId: `import.${payload.fileId}.${Date.now()}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    })
  }
}
