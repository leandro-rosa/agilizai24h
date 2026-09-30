import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GOOGLE_SHEET_MIME } from '../../drive-source/constants/drive.constants'
import type { DriveClient, DriveItem } from '../../drive-source/services/drive-client'
import { readWorkbookRows } from '../../ingestion/utils/read-workbook-rows'
import type { TreasuryDriveConfig } from '../config/treasury-drive.config'
import { TREASURY_DRIVE_MAX_FILE_BYTES } from '../constants/treasury-drive.constants'
import { isAllowedMonthFolder, isRecognizedBankFolder } from '../utils/month-folder-allowlist'
import { detectTreasurySheetSource } from '../utils/detect-source'
import { TreasuryDriveRepository } from './treasury-drive.repository'

/**
 * A fingerprint from metadata alone — never downloaded content. Used for anything this scan
 * does not (or could not) read as a Sheet: `modifiedTime` and `md5Checksum` both change when
 * the real file underneath actually changes, so a re-scan still detects "this file changed" and
 * flips it to `changed`, without ever calling `exportSheet`/`download` on content the scan has
 * no business reading (a non-Sheet file) or that already failed to read.
 */
const metadataFingerprint = (fileItem: DriveItem): string =>
  createHash('sha256').update(JSON.stringify({ mimeType: fileItem.mimeType, modifiedTime: fileItem.modifiedTime, md5Checksum: fileItem.md5Checksum })).digest('hex')

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

            // `files.export` (what `exportSheet` calls on the real Drive) only ever works for a
            // native Google Sheet — every other mimeType (a PDF statement, an uploaded xlsx, a
            // photo of a receipt — all real, seen in the actual "Extratos" folder tree) is
            // rejected with a 403. Never attempted for those; recorded as unrecognized from
            // metadata alone instead. And whatever DOES look like a Sheet is still wrapped in its
            // own try/catch: a corrupt file or an export/read failure must never abort every file
            // after it — the scan as a whole always completes (see this module's design doc,
            // "unreadable/unrecognized file → detected_source: null, scan continues").
            let detectedSource: string | null = null
            let contentSha256: string

            try {
              if (fileItem.mimeType === GOOGLE_SHEET_MIME) {
                const destPath = join(tmp, fileItem.id)
                await client.exportSheet(fileItem.id, destPath, TREASURY_DRIVE_MAX_FILE_BYTES)
                const sheets = await readWorkbookRows(destPath)
                detectedSource = detectTreasurySheetSource(sheets, bankItem.name)
                contentSha256 = createHash('sha256').update(JSON.stringify(sheets)).digest('hex')
              } else {
                contentSha256 = metadataFingerprint(fileItem)
              }
            } catch (error) {
              this.logger.warn(
                `Treasury Drive scan: could not read "${fileItem.name}" (${bankItem.name}/${monthItem.name}): ${(error as Error).message}`,
              )
              detectedSource = null
              contentSha256 = metadataFingerprint(fileItem)
            }

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
