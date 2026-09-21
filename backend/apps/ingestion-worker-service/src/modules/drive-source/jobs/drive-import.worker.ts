import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { DRIVE_QUEUES } from '../constants/drive.constants'
import { DriveImportService } from '../services/drive-import.service'
import type { DriveImportPayload, DriveJobEnvelope } from '../types/drive-jobs'

/** Runs one confirmed import. One at a time: each holds a whole spreadsheet in memory and ends in a period-wide replace. */
@HoldItProcessor(DRIVE_QUEUES.IMPORT, { concurrency: 1 })
export class DriveImportWorker extends HoldItWorkerHost<DriveJobEnvelope<DriveImportPayload>> {
  constructor(private readonly imports: DriveImportService) {
    super()
  }

  async process(job: Job<DriveJobEnvelope<DriveImportPayload>>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) {
      throw new Error(`Unsupported Drive job schemaVersion ${job.data.schemaVersion} on job ${job.id}`)
    }

    await this.imports.runImport(job.data.payload.fileId, job.data.correlationId)

    return { fileId: job.data.payload.fileId }
  }
}
