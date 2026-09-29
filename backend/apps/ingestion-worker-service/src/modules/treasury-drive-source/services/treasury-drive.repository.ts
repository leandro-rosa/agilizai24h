import { Injectable } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'

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
      data: { content_sha256: input.contentSha256, modified_time: input.modifiedTime, detected_source: input.detectedSource, status: 'changed' },
    })
  }

  markImported(id: string, accountId: number) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'imported', imported_at: new Date(), imported_account_id: accountId } })
  }

  markImporting(id: string) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'importing' } })
  }

  markError(id: string, detail: string) {
    return this.prisma.treasuryDriveFile.update({ where: { id }, data: { status: 'error', error_detail: detail } })
  }
}
