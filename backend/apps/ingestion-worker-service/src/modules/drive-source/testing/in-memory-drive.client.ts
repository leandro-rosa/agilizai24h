import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { GOOGLE_FOLDER_MIME, GOOGLE_SHEET_MIME, XLSX_MIME } from '../constants/drive.constants'
import { streamToFile, type DownloadResult, type DriveClient, type DriveItem } from '../services/drive-client'

/** A native Google Sheet in a test tree: it has no size and no md5, like the real thing. */
export interface NativeSheet {
  sheet: Buffer | string
}

/** Names map to file content (a file), a NativeSheet (a native sheet) or a nested object (a folder). */
export type DriveTree = { [name: string]: Buffer | string | NativeSheet | DriveTree }

const isSheet = (value: unknown): value is NativeSheet => typeof value === 'object' && value !== null && 'sheet' in value
const isBytes = (value: unknown): value is Buffer | string => typeof value === 'string' || Buffer.isBuffer(value)

/**
 * A Drive that lives in memory, for tests. It behaves like the real client where
 * it matters to this feature: a scan sees only metadata, content moves only when
 * `download`/`exportSheet` is called, editing a file changes its checksum and
 * version, and every call is recorded so a test can prove what was — and was not —
 * read. It also never touches the network, so no test can reach a real Drive.
 */
export class InMemoryDriveClient implements DriveClient {
  readonly listed: string[] = []
  readonly downloaded: string[] = []
  readonly exported: string[] = []

  private readonly items = new Map<string, DriveItem>()
  private readonly children = new Map<string, string[]>()
  private readonly contents = new Map<string, Buffer>()
  private listingError: Error | null = null
  private readonly folderFailures = new Map<string, Error>()
  private readonly downloadErrors = new Map<string, Error>()
  private sequence = 0

  /** Builds a folder tree under `rootId` from a nested object. */
  static fromTree(rootId: string, tree: DriveTree): InMemoryDriveClient {
    const client = new InMemoryDriveClient()
    client.children.set(rootId, [])
    client.addTree(rootId, tree)
    return client
  }

  private addTree(parentId: string, tree: DriveTree): void {
    for (const [name, value] of Object.entries(tree)) {
      if (isBytes(value)) this.addFile(parentId, name, value)
      else if (isSheet(value)) this.addFile(parentId, name, value.sheet, true)
      else this.addTree(this.addFolder(parentId, name), value)
    }
  }

  addFolder(parentId: string, name: string): string {
    const id = `folder-${++this.sequence}`
    this.register({
      id,
      name,
      mimeType: GOOGLE_FOLDER_MIME,
      isFolder: true,
      size: null,
      md5Checksum: null,
      modifiedTime: '2026-09-01T00:00:00.000Z',
      version: null,
      parents: [parentId],
      trashed: false,
    })
    this.children.set(id, [])
    return id
  }

  addFile(parentId: string, name: string, content: Buffer | string, nativeSheet = false, id?: string): string {
    const fileId = id ?? `file-${++this.sequence}`
    const bytes = Buffer.from(content)
    this.contents.set(fileId, bytes)
    this.register({
      id: fileId,
      name,
      mimeType: nativeSheet ? GOOGLE_SHEET_MIME : XLSX_MIME,
      isFolder: false,
      size: nativeSheet ? null : bytes.length,
      md5Checksum: nativeSheet ? null : createHash('md5').update(bytes).digest('hex'),
      modifiedTime: '2026-09-02T11:32:00.000Z',
      version: '1',
      parents: [parentId],
      trashed: false,
    })
    return fileId
  }

  private register(item: DriveItem): void {
    this.items.set(item.id, item)
    const siblings = this.children.get(item.parents[0]) ?? []
    siblings.push(item.id)
    this.children.set(item.parents[0], siblings)
  }

  /** Simulates an edit in the Drive: new bytes, so a new checksum, a new version and a later modified time. */
  edit(fileId: string, content: Buffer | string): void {
    const item = this.mustGet(fileId)
    const bytes = Buffer.from(content)
    this.contents.set(fileId, bytes)
    this.items.set(fileId, {
      ...item,
      size: item.mimeType === GOOGLE_SHEET_MIME ? null : bytes.length,
      md5Checksum: item.mimeType === GOOGLE_SHEET_MIME ? null : createHash('md5').update(bytes).digest('hex'),
      version: String(Number(item.version ?? '1') + 1),
      modifiedTime: new Date(Date.parse(item.modifiedTime) + 60_000).toISOString(),
    })
  }

  /** Changes only the modified time and version, as opening and saving a Sheet does. */
  touch(fileId: string): void {
    const item = this.mustGet(fileId)
    this.items.set(fileId, {
      ...item,
      version: String(Number(item.version ?? '1') + 1),
      modifiedTime: new Date(Date.parse(item.modifiedTime) + 60_000).toISOString(),
    })
  }

  trash(fileId: string): void {
    this.items.set(fileId, { ...this.mustGet(fileId), trashed: true })
  }

  remove(fileId: string): void {
    const item = this.mustGet(fileId)
    this.items.delete(fileId)
    this.children.set(item.parents[0], (this.children.get(item.parents[0]) ?? []).filter(id => id !== fileId))
  }

  failListing(error: Error = new Error('The Drive returned 403: the folder is no longer shared')): void {
    this.listingError = error
  }

  /** Fails only the listing of the folder with this name, to simulate a scan that breaks halfway. */
  failListingOfFolder(folderName: string, error: Error): void {
    this.folderFailures.set(folderName, error)
  }

  failDownload(fileId: string, error: Error): void {
    this.downloadErrors.set(fileId, error)
  }

  contentOf(fileId: string): Buffer {
    const content = this.contents.get(fileId)
    if (!content) throw new Error(`No such file in the fake Drive: ${fileId}`)
    return content
  }

  async *listFolder(folderId: string): AsyncIterable<DriveItem> {
    this.listed.push(folderId)
    if (this.listingError) throw this.listingError

    const folderFailure = this.folderFailures.get(this.items.get(folderId)?.name ?? '')
    if (folderFailure) throw folderFailure

    for (const id of this.children.get(folderId) ?? []) {
      const item = this.items.get(id)
      if (item && !item.trashed) yield item
    }
  }

  async download(fileId: string, destPath: string, maxBytes: number): Promise<DownloadResult> {
    this.downloaded.push(fileId)
    return this.stream(fileId, destPath, maxBytes)
  }

  async exportSheet(fileId: string, destPath: string, maxBytes: number): Promise<DownloadResult> {
    this.exported.push(fileId)
    return this.stream(fileId, destPath, maxBytes)
  }

  private stream(fileId: string, destPath: string, maxBytes: number): Promise<DownloadResult> {
    const failure = this.downloadErrors.get(fileId)
    if (failure) throw failure
    return streamToFile(Readable.from([this.contentOf(fileId)]), destPath, maxBytes)
  }

  private mustGet(fileId: string): DriveItem {
    const item = this.items.get(fileId)
    if (!item) throw new Error(`No such item in the fake Drive: ${fileId}`)
    return item
  }
}
