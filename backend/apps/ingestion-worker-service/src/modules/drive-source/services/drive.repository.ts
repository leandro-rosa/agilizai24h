import { Injectable } from '@nestjs/common'
import type { Prisma } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { DRIVE_SCAN_RUNS_RETAINED, type DriveFileStatus } from '../constants/drive.constants'

export type DriveScanTrigger = 'schedule' | 'manual'

/** A scan that has been `running` this long is presumed dead, not slow. */
const STALE_SCAN_RUN_MS = 30 * 60 * 1000

/** The person's confirmation recorded when an import is claimed. */
export interface ImportClaim {
  confirmedBy: string | null
  fileType: string
  period: string
  /** The content hash whose inconsistencies the person reviewed, when validation required it. */
  validationConfirmedSha256?: string
}

/**
 * Persistence for the Drive source, and nothing else: no rules live here. The
 * one place that carries a guarantee is `claimForImport`, a conditional update
 * that is what makes two simultaneous import requests create one ingestion.
 */
@Injectable()
export class DriveRepository {
  constructor(private readonly prisma: PrismaClientService) {}

  findById(id: string) {
    return this.prisma.driveFile.findUnique({ where: { id } })
  }

  findByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([])
    return this.prisma.driveFile.findMany({ where: { id: { in: ids } } })
  }

  findByDriveFileId(driveFileId: string) {
    return this.prisma.driveFile.findUnique({ where: { drive_file_id: driveFileId } })
  }

  list(statuses?: DriveFileStatus[]) {
    return this.prisma.driveFile.findMany({
      where: statuses && statuses.length > 0 ? { status: { in: statuses } } : undefined,
      orderBy: [{ path: 'asc' }, { name: 'asc' }],
    })
  }

  create(data: Prisma.DriveFileUncheckedCreateInput) {
    return this.prisma.driveFile.create({ data })
  }

  update(id: string, data: Prisma.DriveFileUncheckedUpdateInput) {
    return this.prisma.driveFile.update({ where: { id }, data })
  }

  /**
   * Moves a file to `importing` only if it is still in one of the `from` states.
   * Returns false when it is not — another request got there first, or the file
   * is not in an importable state — which the caller turns into HTTP 409.
   */
  async claimForImport(id: string, from: readonly DriveFileStatus[], claim: ImportClaim): Promise<boolean> {
    const { count } = await this.prisma.driveFile.updateMany({
      where: { id, status: { in: [...from] } },
      data: {
        status: 'importing',
        error: null,
        confirmed_by: claim.confirmedBy,
        confirmed_at: new Date(),
        import_file_type: claim.fileType,
        import_period: claim.period,
        validation_confirmed_sha256: claim.validationConfirmedSha256 ?? null,
        validation_confirmed_by: claim.validationConfirmedSha256 ? claim.confirmedBy : null,
        validation_confirmed_at: claim.validationConfirmedSha256 ? new Date() : null,
      },
    })

    return count === 1
  }

  /**
   * Content hashes of files imported for the same type and period, other than
   * `exceptId`. The duplicate check reads this; the unique index on the same
   * three columns is what still refuses a race between two imports.
   */
  findImportedByContent(sha256: string, fileType: string, period: string, exceptId?: string) {
    return this.prisma.driveFile.findFirst({
      where: {
        imported_sha256: sha256,
        imported_file_type: fileType,
        imported_period: period,
        status: 'imported',
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    })
  }

  /** Ingestions by id, for deriving the effective status of imported files. */
  findIngestions(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([])
    return this.prisma.ingestion.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, error: true, uploaded_at: true },
    })
  }

  /** The latest completed or partially completed ingestion of a type and period: what an import would replace. */
  findReplaceableIngestion(fileType: string, period: string) {
    return this.prisma.ingestion.findFirst({
      where: { file_type: fileType, period, status: { in: ['completed', 'partially_completed'] } },
      orderBy: { uploaded_at: 'desc' },
      select: { id: true, status: true, uploaded_at: true },
    })
  }

  /**
   * Opens a scan run. A run left `running` by a process that died mid-scan is
   * closed first as interrupted, so it can never block "Sincronizar agora" for good.
   */
  async startScanRun(trigger: DriveScanTrigger) {
    await this.prisma.driveScanRun.updateMany({
      where: { outcome: 'running', started_at: { lt: new Date(Date.now() - STALE_SCAN_RUN_MS) } },
      data: { outcome: 'failed', finished_at: new Date(), error: 'Interrupted: the process stopped before the scan finished' },
    })

    return this.prisma.driveScanRun.create({ data: { trigger } })
  }

  finishScanRun(
    id: number,
    result: {
      outcome: 'ok' | 'failed'
      filesSeen: number
      skippedByPattern: number
      newCount: number
      changedCount: number
      error?: string
    },
  ) {
    return this.prisma.driveScanRun.update({
      where: { id },
      data: {
        finished_at: new Date(),
        outcome: result.outcome,
        files_seen: result.filesSeen,
        skipped_by_pattern: result.skippedByPattern,
        new_count: result.newCount,
        changed_count: result.changedCount,
        error: result.error ?? null,
      },
    })
  }

  latestScanRun() {
    return this.prisma.driveScanRun.findFirst({ orderBy: { started_at: 'desc' } })
  }

  /** True while a scan has started, not finished, and is recent enough to still be alive. */
  async hasRunningScan(): Promise<boolean> {
    return (
      (await this.prisma.driveScanRun.count({
        where: { outcome: 'running', started_at: { gte: new Date(Date.now() - STALE_SCAN_RUN_MS) } },
      })) > 0
    )
  }

  /** Keeps the newest `keep` runs and deletes the rest. Returns how many were deleted. */
  async pruneScanRuns(keep: number = DRIVE_SCAN_RUNS_RETAINED): Promise<number> {
    const keepers = await this.prisma.driveScanRun.findMany({
      orderBy: { started_at: 'desc' },
      take: keep,
      select: { id: true },
    })
    if (keepers.length < keep) return 0

    const { count } = await this.prisma.driveScanRun.deleteMany({
      where: { id: { notIn: keepers.map(run => run.id) } },
    })

    return count
  }
}
