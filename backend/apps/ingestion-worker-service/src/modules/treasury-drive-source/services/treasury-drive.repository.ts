import { Injectable } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import type { TreasuryDriveFileStatus } from '../constants/treasury-drive.constants'

/** Every status an import may still be claimed from — not `imported` (already done) nor `importing` (someone else has it). */
const CLAIMABLE_STATUSES: readonly TreasuryDriveFileStatus[] = ['new', 'changed', 'error']

@Injectable()
export class TreasuryDriveRepository {
  constructor(private readonly prisma: PrismaClientService) {}

  list() {
    return this.prisma.treasuryDriveFile.findMany({ orderBy: [{ month_folder_name: 'desc' }, { bank_folder_name: 'asc' }] })
  }

  findById(id: string) {
    return this.prisma.treasuryDriveFile.findUnique({ where: { id } })
  }

  /** Looked up by the Drive's own file id — what a scan iterates on — never the internal `id`. */
  findByDriveFileId(driveFileId: string) {
    return this.prisma.treasuryDriveFile.findUnique({ where: { drive_file_id: driveFileId } })
  }

  async upsertSeen(input: {
    driveFileId: string
    monthFolderName: string
    bankFolderName: string
    detectedSource: string | null
    name: string
    mimeType: string
    modifiedTime: Date
    contentSha256: string
  }) {
    const existing = await this.prisma.treasuryDriveFile.findUnique({ where: { drive_file_id: input.driveFileId } })

    if (!existing) {
      return this.prisma.treasuryDriveFile.create({
        data: {
          drive_file_id: input.driveFileId,
          month_folder_name: input.monthFolderName,
          bank_folder_name: input.bankFolderName,
          detected_source: input.detectedSource,
          name: input.name,
          mime_type: input.mimeType,
          modified_time: input.modifiedTime,
          content_sha256: input.contentSha256,
          status: 'new',
        },
      })
    }

    if (existing.content_sha256 === input.contentSha256) return existing
    // Only bump status for a genuine content change — an already-imported file never silently reverts to "new".
    if (existing.status === 'imported' || existing.status === 'importing') return existing

    return this.prisma.treasuryDriveFile.update({
      where: { id: existing.id },
      data: { content_sha256: input.contentSha256, modified_time: input.modifiedTime, detected_source: input.detectedSource, mime_type: input.mimeType, status: 'changed' },
    })
  }

  markImported(id: string, accountId: number) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'imported', imported_at: new Date(), imported_account_id: accountId } })
  }

  /**
   * Moves a file to `importing` only if it is still in one of `CLAIMABLE_STATUSES` — an atomic
   * conditional `updateMany`, not a read-then-write, so of two truly simultaneous imports of the
   * same file exactly one wins. Mirrors `DriveRepository.claimForImport`'s exact pattern (the
   * sibling Drive source's own defense against this same race — see that file's own doc
   * comment: "the one place that carries a guarantee"). Returns false when the file is not in a
   * claimable state — another import got there first, or it is already `imported` — which the
   * caller turns into the same `already_imported` refusal as the sequential case.
   */
  async claimForImporting(id: string): Promise<boolean> {
    const { count } = await this.prisma.treasuryDriveFile.updateMany({
      where: { id, status: { in: [...CLAIMABLE_STATUSES] } },
      data: { status: 'importing' },
    })
    return count === 1
  }

  markError(id: string, detail: string) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'error', error_detail: detail } })
  }

  /**
   * Sets or clears `ignored`, mirroring `DriveImportService.setIgnored`'s status flip — but with
   * no business-rule refusal of its own (no equivalent of that service's `not_ignorable`/
   * `not_ignored` codes): the controller only ever calls this after confirming the file exists,
   * and un-ignoring always lands back on `new` rather than trying to recall whether it was
   * `changed` before, which this table has no history of.
   */
  setIgnored(id: string, ignored: boolean) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: ignored ? 'ignored' : 'new' } })
  }
}
