import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import { DRIVE_QUEUES } from '../constants/drive.constants'
import { DriveScanService } from '../services/drive-scan.service'
import type { DriveJobEnvelope, DriveScanPayload } from '../types/drive-jobs'

/** Runs one scan — the daily schedule and "Sincronizar agora" both land here. */
@HoldItProcessor(DRIVE_QUEUES.SCAN)
export class DriveScanWorker extends HoldItWorkerHost<DriveJobEnvelope<DriveScanPayload>> {
  constructor(private readonly scans: DriveScanService) {
    super()
  }

  async process(job: Job<DriveJobEnvelope<DriveScanPayload>>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) {
      throw new Error(`Unsupported Drive job schemaVersion ${job.data.schemaVersion} on job ${job.id}`)
    }

    return this.scans.scan(job.data.payload.trigger)
  }
}
