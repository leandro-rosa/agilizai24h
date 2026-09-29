import { Inject } from '@nestjs/common'
import { HoldItProcessor, HoldItWorkerHost } from '@app/hold-it'
import type { Job } from 'bullmq'
import type { DriveConfig } from '../../drive-source/config/drive.config'
import { DisabledDriveClient } from '../../drive-source/services/disabled-drive.client'
import { createGoogleDriveClient } from '../../drive-source/services/google-drive.client'
import { TREASURY_DRIVE_CONFIG, type TreasuryDriveConfig } from '../config/treasury-drive.config'
import { TREASURY_DRIVE_QUEUES } from '../constants/treasury-drive.constants'
import { TreasuryDriveScanService } from '../services/treasury-drive-scan.service'

/**
 * Every treasury Drive scan job carries the same minimal envelope as the
 * sales/abastecimento Drive source's own jobs (`drive-jobs.ts`), so a worker
 * can refuse a payload it does not understand instead of misreading it
 * after a deploy.
 */
export interface TreasuryDriveScanJobEnvelope {
  schemaVersion: 1
  trigger: 'schedule' | 'manual'
}

/** Runs one treasury Drive scan — the daily schedule and a manual trigger both land here. */
@HoldItProcessor(TREASURY_DRIVE_QUEUES.SCAN)
export class TreasuryDriveScanWorker extends HoldItWorkerHost<TreasuryDriveScanJobEnvelope> {
  constructor(
    @Inject(TREASURY_DRIVE_CONFIG) private readonly config: TreasuryDriveConfig,
    private readonly scans: TreasuryDriveScanService,
  ) {
    super()
  }

  async process(job: Job<TreasuryDriveScanJobEnvelope>): Promise<unknown> {
    if (job.data.schemaVersion !== 1) {
      throw new Error(`Unsupported treasury Drive scan job schemaVersion ${job.data.schemaVersion} on job ${job.id}`)
    }

    // Reuses the sales/abastecimento source's real Drive client: same read-only
    // service-account auth, same xlsx export path — only the credential/root
    // folder differ, and TreasuryDriveConfig carries its own copy of both.
    // createGoogleDriveClient only ever reads `config.credential`, so a
    // structurally-compatible object stands in for the full DriveConfig shape.
    const client = this.config.enabled && this.config.credential
      ? createGoogleDriveClient({ credential: this.config.credential } as DriveConfig)
      : new DisabledDriveClient()

    return this.scans.scan(client, this.config)
  }
}
