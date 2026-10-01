import { readFile } from 'node:fs/promises'
import type { TreasurySource } from '@app/treasury-ingestion-contracts'
import { GOOGLE_SHEET_MIME } from '../../drive-source/constants/drive.constants'
import type { DriveClient } from '../../drive-source/services/drive-client'
import { readWorkbookRows, type SheetRows } from '../../ingestion/utils/read-workbook-rows'
import { extractPdfPages, PdfPasswordRequiredError, type PdfPage } from '../../treasury-ingestion/utils/pdf-text'
import { detectTreasurySheetSource } from './detect-source'
import { detectTreasuryPdfSource } from './detect-pdf-source'

const ZIP_MAGIC = Buffer.from([0x50, 0x4b]) // "PK"
const PDF_MAGIC = Buffer.from('%PDF')

export interface ReadAndClassifyResult {
  detectedSource: TreasurySource | null
  contentSha256: string
  sheets?: SheetRows[]
  pages?: PdfPage[]
}

/**
 * Reads a treasury Drive file's real content and classifies it, regardless of what Drive's own
 * `mimeType` claims. A real file found in the "Extratos" folder (the "pagseguro" folder's own
 * statement) is reported as `application/pdf` by Drive but its actual bytes are a zip/xlsx — so
 * this never trusts the claimed mimeType for anything except deciding whether `exportSheet`
 * (native Sheet only) is even possible; everything else is identified from its own real bytes.
 * Takes `fileId`/`mimeType` as scalars rather than a full `DriveItem`: the import path (Task 8)
 * only has these two persisted on `TreasuryDriveFile`, with no Drive call to refetch the rest.
 */
export async function readAndClassifyTreasuryDriveFile(
  client: DriveClient,
  fileId: string,
  mimeType: string,
  bankFolderName: string,
  destPath: string,
  maxBytes: number,
  pdfPassword: string | undefined,
): Promise<ReadAndClassifyResult> {
  if (mimeType === GOOGLE_SHEET_MIME) {
    const { sha256 } = await client.exportSheet(fileId, destPath, maxBytes)
    const sheets = await readWorkbookRows(destPath)
    return { detectedSource: detectTreasurySheetSource(sheets, bankFolderName), contentSha256: sha256, sheets }
  }

  const { sha256 } = await client.download(fileId, destPath, maxBytes)
  const bytes = await readFile(destPath)
  const magic = bytes.subarray(0, 4)

  if (magic.subarray(0, 2).equals(ZIP_MAGIC)) {
    const sheets = await readWorkbookRows(destPath)
    return { detectedSource: detectTreasurySheetSource(sheets, bankFolderName), contentSha256: sha256, sheets }
  }

  if (magic.equals(PDF_MAGIC)) {
    try {
      const pages = await extractPdfPages(bytes)
      return { detectedSource: detectTreasuryPdfSource(pages, bankFolderName), contentSha256: sha256, pages }
    } catch (error) {
      if (error instanceof PdfPasswordRequiredError && pdfPassword !== undefined) {
        const pages = await extractPdfPages(bytes, pdfPassword)
        return { detectedSource: detectTreasuryPdfSource(pages, bankFolderName), contentSha256: sha256, pages }
      }
      // Wrong/missing password, or any other read failure: unrecognized, never thrown further —
      // the metadata-based sha256 from `download` above is still a valid fingerprint for re-scan
      // change detection even though the content itself couldn't be read.
      return { detectedSource: null, contentSha256: sha256 }
    }
  }

  return { detectedSource: null, contentSha256: sha256 }
}
