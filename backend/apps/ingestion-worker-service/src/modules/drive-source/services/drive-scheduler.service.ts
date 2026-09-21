import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { HoldItBullMQBroker } from '@app/hold-it'
import { DRIVE_CONFIG, type DriveConfig } from '../config/drive.config'
import { DRIVE_QUEUES, DRIVE_SCHEDULER_ID, DRIVE_TIME_ZONE } from '../constants/drive.constants'
import { driveEnvelope } from '../types/drive-jobs'

/**
 * Keeps the daily scan registered exactly when the Drive source is configured.
 *
 * Registration is a BullMQ job scheduler with a FIXED id, so restarts and
 * replicas upsert the same schedule instead of stacking new ones. When the
 * source is NOT configured the schedule is removed, so unsetting the variables
 * really does stop the scans — without this, a schedule left in Redis by an
 * earlier run would keep firing.
 */
@Injectable()
export class DriveSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DriveSchedulerService.name)

  constructor(
    @Inject(DRIVE_CONFIG) private readonly config: DriveConfig,
    private readonly broker: HoldItBullMQBroker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const queue = await this.broker.getQueue(DRIVE_QUEUES.SCAN)

      if (this.config.enabled) {
        await queue.upsertJobScheduler(
          DRIVE_SCHEDULER_ID,
          { pattern: this.config.scanCron, tz: DRIVE_TIME_ZONE },
          {
            name: DRIVE_QUEUES.SCAN,
            data: driveEnvelope({ trigger: 'schedule' as const }),
            opts: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
          },
        )
        this.logger.log(`Drive scan scheduled: "${this.config.scanCron}" (${DRIVE_TIME_ZONE})`)
      } else {
        await queue.removeJobScheduler(DRIVE_SCHEDULER_ID)
      }
    } catch (error) {
      // A schedule that cannot be registered must not take the whole service down with it:
      // "Sincronizar agora" still works, and the failure is loud in the log.
      this.logger.error(`Could not update the Drive scan schedule: ${(error as Error).message}`)
    }
  }
}
