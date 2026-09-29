import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DriveClient } from '../../drive-source/services/drive-client'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'
import type { TreasuryDriveConfig } from '../config/treasury-drive.config'
import { isAllowedMonthFolder, isRecognizedBankFolder } from '../utils/month-folder-allowlist'
import { detectTreasurySheetSource } from '../utils/detect-source'
import { TreasuryDriveRepository } from './treasury-drive.repository'

@Injectable()
export class TreasuryDriveScanService {
  private readonly logger = new Logger(TreasuryDriveScanService.name)

  constructor(private readonly repository: TreasuryDriveRepository) {}

  async scan(client: DriveClient, config: TreasuryDriveConfig): Promise<{ seen: number; new: number; changed: number }> {
    if (!config.rootFolderId) return { seen: 0, new: 0, changed: 0 }

    let seen = 0
    let newCount = 0
    let changedCount = 0
    const tmp = mkdtempSync(join(tmpdir(), 'treasury-drive-scan-'))

    try {
      for await (const monthItem of client.listFolder(config.rootFolderId)) {
        if (!monthItem.isFolder || !isAllowedMonthFolder(monthItem.name, config.monthFolders)) continue

        for await (const bankItem of client.listFolder(monthItem.id)) {
          if (!bankItem.isFolder || !isRecognizedBankFolder(bankItem.name)) continue

          for await (const fileItem of client.listFolder(bankItem.id)) {
            if (fileItem.isFolder) continue // e.g. "comprovantes itau" — noise, never descended into

            seen++
            const destPath = join(tmp, fileItem.id)
            await client.exportSheet(fileItem.id, destPath, 25 * 1024 * 1024)
            const sheets = await readWorkbookRows(destPath)
            const detectedSource = detectTreasurySheetSource(sheets, bankItem.name)
            const contentSha256 = createHash('sha256').update(JSON.stringify(sheets)).digest('hex')

            // Looked up by the Drive's own file id — the internal `id` is a Prisma-generated
            // uuid the scan never sees, so checking `findById(fileItem.id)` would always miss
            // and double-count every already-tracked file as "new" on every re-scan.
            const before = await this.repository.findByDriveFileId(fileItem.id)
            const result = await this.repository.upsertSeen({
              driveFileId: fileItem.id,
              monthFolderName: monthItem.name,
              bankFolderName: bankItem.name,
              detectedSource,
              name: fileItem.name,
              modifiedTime: new Date(fileItem.modifiedTime),
              contentSha256,
            })

            if (!before) newCount++
            else if (result.status === 'changed') changedCount++
          }
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }

    this.logger.log(`Treasury Drive scan: ${seen} file(s) seen, ${newCount} new, ${changedCount} changed`)
    return { seen, new: newCount, changed: changedCount }
  }
}
