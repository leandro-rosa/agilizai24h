import { Injectable } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { DRIVE_QUEUES } from '../constants/drive.constants'
import {
  driveEnvelope,
  type DriveImportPayload,
  type DriveScanPayload,
  type DriveValidatePayload,
} from '../types/drive-jobs'

export type EnqueueScanResult = 'queued' | 'already_running'

/** The only place that puts Drive jobs on the queues. */
@Injectable()
export class DriveProducer {
  constructor(private readonly broker: HoldItBullMQBroker) {}

  /**
   * Queues a manual scan unless one is already waiting or active, so two clicks
   * on "Sincronizar agora" collapse into one run.
   *
   * It deliberately does NOT use a fixed `jobId` to deduplicate: hold-it retains
   * a completed job for two hours and BullMQ ignores a job added under an id it
   * still retains, which would silently make the button do nothing for two hours.
   * It also looks only at `waiting` and `active`, never `delayed`: the scheduler
   * keeps the NEXT daily scan in the queue as a delayed job, and counting that
   * would block manual syncs forever.
   */
  async enqueueScan(payload: DriveScanPayload, correlationId?: string): Promise<EnqueueScanResult> {
    const queue = await this.broker.getQueue(DRIVE_QUEUES.SCAN)
    const inFlight = await queue.getJobs(['waiting', 'active'])

    if (inFlight.length > 0) return 'already_running'

    await this.broker.holdIt({
      queueName: DRIVE_QUEUES.SCAN,
      message: driveEnvelope(payload, correlationId),
      options: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
    })

    return 'queued'
  }

  /**
   * One validation per file at a time: the job id is derived from the file, and
   * completed jobs are removed at once so a later change can queue it again.
   */
  async enqueueValidation(payload: DriveValidatePayload, correlationId?: string): Promise<void> {
    await this.broker.holdIt({
      queueName: DRIVE_QUEUES.VALIDATE,
      message: driveEnvelope(payload, correlationId),
      options: {
        jobId: `validate.${payload.fileId}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    })
  }

  async enqueueImport(payload: DriveImportPayload, correlationId?: string): Promise<void> {
    await this.broker.holdIt({
      queueName: DRIVE_QUEUES.IMPORT,
      message: driveEnvelope(payload, payload.correlationId ?? correlationId),
      options: {
        jobId: `import.${payload.fileId}.${Date.now()}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    })
  }
}
