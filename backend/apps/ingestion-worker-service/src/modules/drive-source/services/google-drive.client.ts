import type { Readable } from 'node:stream'
import { auth, drive as createDrive } from '@googleapis/drive'
import type { DriveConfig } from '../config/drive.config'
import { DRIVE_SCOPE, GOOGLE_FOLDER_MIME, XLSX_MIME } from '../constants/drive.constants'
import { streamToFile, type DownloadResult, type DriveClient, type DriveItem } from './drive-client'

interface RawDriveFile {
  id?: string | null
  name?: string | null
  mimeType?: string | null
  size?: string | null
  md5Checksum?: string | null
  modifiedTime?: string | null
  version?: string | null
  parents?: string[] | null
  trashed?: boolean | null
}

/** The slice of the Drive v3 API this client uses: small enough to stub in tests. */
export interface DriveApi {
  files: {
    list(params: Record<string, unknown>): Promise<{ data: { files?: RawDriveFile[]; nextPageToken?: string | null } }>
    get(params: Record<string, unknown>, options: { responseType: 'stream' }): Promise<{ data: Readable }>
    export(params: Record<string, unknown>, options: { responseType: 'stream' }): Promise<{ data: Readable }>
  }
}

/** Metadata only: no links, no thumbnails, and above all no content. */
const LIST_FIELDS = 'nextPageToken, files(id,name,mimeType,size,md5Checksum,modifiedTime,version,parents,trashed)'

/**
 * Drive ids are letters, digits, `-` and `_`. The id goes into a query string,
 * so anything else is refused rather than escaped: a folder id that could bend
 * the query is a bug, not input to be cleaned.
 */
const DRIVE_ID = /^[A-Za-z0-9_-]+$/

const toItem = (file: RawDriveFile): DriveItem => ({
  id: file.id ?? '',
  name: file.name ?? '',
  mimeType: file.mimeType ?? '',
  isFolder: file.mimeType === GOOGLE_FOLDER_MIME,
  size: file.size !== undefined && file.size !== null ? Number(file.size) : null,
  md5Checksum: file.md5Checksum ?? null,
  modifiedTime: file.modifiedTime ?? '',
  version: file.version ?? null,
  parents: file.parents ?? [],
  trashed: file.trashed === true,
})

/** Read-only access to the Drive. Nothing here writes, moves or deletes anything in it. */
export class GoogleDriveClient implements DriveClient {
  constructor(private readonly drive: DriveApi) {}

  async *listFolder(folderId: string): AsyncIterable<DriveItem> {
    if (!DRIVE_ID.test(folderId)) {
      throw new Error('The Drive folder id is not valid: expected letters, digits, "-" and "_"')
    }

    let pageToken: string | undefined

    do {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: LIST_FIELDS,
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })

      for (const file of response.data.files ?? []) {
        const item = toItem(file)
        if (!item.trashed) yield item
      }

      pageToken = response.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  async download(fileId: string, destPath: string, maxBytes: number): Promise<DownloadResult> {
    const response = await this.drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' })

    return streamToFile(response.data, destPath, maxBytes)
  }

  async exportSheet(fileId: string, destPath: string, maxBytes: number): Promise<DownloadResult> {
    const response = await this.drive.files.export({ fileId, mimeType: XLSX_MIME }, { responseType: 'stream' })

    return streamToFile(response.data, destPath, maxBytes)
  }
}

/**
 * Builds the real client from the validated configuration: a service account
 * with the read-only scope. The credential is read here and nowhere else, and
 * is never logged.
 */
export function createGoogleDriveClient(config: DriveConfig): DriveClient {
  if (!config.credential) {
    throw new Error('The Drive credential is not configured')
  }

  const googleAuth = new auth.GoogleAuth(
    config.credential.kind === 'file'
      ? { keyFile: config.credential.path, scopes: [DRIVE_SCOPE] }
      : {
          credentials: JSON.parse(Buffer.from(config.credential.value, 'base64').toString('utf8')),
          scopes: [DRIVE_SCOPE],
        },
  )

  return new GoogleDriveClient(createDrive({ version: 'v3', auth: googleAuth }) as unknown as DriveApi)
}
