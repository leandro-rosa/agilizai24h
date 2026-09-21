import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { DRIVE_QUEUES } from '../constants/drive.constants'
import { DriveValidationService } from '../services/drive-validation.service'
import type { DriveJobEnvelope, DriveValidatePayload } from '../types/drive-jobs'

/** Validates one file at a time: each one reads a spreadsheet into memory, and the Drive is not in a hurry. */
@HoldItProcessor(DRIVE_QUEUES.VALIDATE, { concurrency: 1 })
export class DriveValidateWorker extends HoldItWorkerHost<DriveJobEnvelope<DriveValidatePayload>> {
  constructor(private readonly validation: DriveValidationService) {
    super()
  }

  async process(job: Job<DriveJobEnvelope<DriveValidatePayload>>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) {
      throw new Error(`Unsupported Drive job schemaVersion ${job.data.schemaVersion} on job ${job.id}`)
    }

    const { fileId, fileType, period } = job.data.payload
    const report = await this.validation.validate(fileId, { fileType, period })

    return report ? { fileId, outcome: report.outcome } : { fileId, outcome: 'skipped' }
  }
}
