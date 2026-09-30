import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_DRIVE_CONFIG, type TreasuryDriveConfig } from '../config/treasury-drive.config'
import { TREASURY_DRIVE_QUEUES, TREASURY_DRIVE_SCHEDULER_ID, TREASURY_DRIVE_TIME_ZONE } from '../constants/treasury-drive.constants'
import type { TreasuryDriveScanJobEnvelope } from '../jobs/treasury-drive-scan.worker'

/**
 * Keeps the daily treasury Drive scan registered exactly when the source is configured —
 * mirrors `DriveSchedulerService` (the sibling sales/abastecimento scheduler) exactly, including
 * the fixed BullMQ job scheduler id (so restarts/replicas upsert the same schedule instead of
 * stacking new ones) and removing the schedule when the source is not configured (so unsetting
 * the env vars really does stop the scans instead of leaving a stale schedule firing in Redis).
 *
 * The job data MUST be a `TreasuryDriveScanJobEnvelope` — `TreasuryDriveScanWorker.process`
 * (Task 8) throws on any job whose `data.schemaVersion !== 1`, exactly the same envelope
 * `TreasuryDriveProducer.enqueueScan` builds for "Sincronizar agora". `trigger: 'schedule'`
 * distinguishes the two the same way `DriveScanPayload.trigger` does for the sibling source.
 */
@Injectable()
export class TreasuryDriveSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TreasuryDriveSchedulerService.name)

  constructor(
    @Inject(TREASURY_DRIVE_CONFIG) private readonly config: TreasuryDriveConfig,
    private readonly broker: HoldItBullMQBroker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const queue = await this.broker.getQueue(TREASURY_DRIVE_QUEUES.SCAN)

      if (this.config.enabled) {
        const data: TreasuryDriveScanJobEnvelope = { schemaVersion: 1, trigger: 'schedule' }

        await queue.upsertJobScheduler(
          TREASURY_DRIVE_SCHEDULER_ID,
          { pattern: this.config.scanCron, tz: TREASURY_DRIVE_TIME_ZONE },
          { name: TREASURY_DRIVE_QUEUES.SCAN, data, opts: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } } },
        )
        this.logger.log(`Treasury Drive scan scheduled: "${this.config.scanCron}" (${TREASURY_DRIVE_TIME_ZONE})`)
      } else {
        await queue.removeJobScheduler(TREASURY_DRIVE_SCHEDULER_ID)
      }
    } catch (error) {
      // A schedule that cannot be registered must not take the whole service down with it:
      // "Sincronizar agora" still works, and the failure is loud in the log.
      this.logger.error(`Could not update the treasury Drive scan schedule: ${(error as Error).message}`)
    }
  }
}
