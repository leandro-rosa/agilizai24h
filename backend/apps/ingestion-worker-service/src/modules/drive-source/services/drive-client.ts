import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Injection token: the app talks to the Drive only through this interface, so tests never need Google. */
export const DRIVE_CLIENT = Symbol('DRIVE_CLIENT')

/** File and folder metadata as the scan needs it. Never any content. */
export interface DriveItem {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  /** Bytes; null for folders and for native Google Sheets, which report none. */
  size: number | null
  md5Checksum: string | null
  /** ISO 8601. */
  modifiedTime: string
  version: string | null
  parents: string[]
  trashed: boolean
}

export interface DownloadResult {
  /** SHA-256 of the bytes written, computed while streaming. */
  sha256: string
  bytes: number
}

/** Thrown while streaming when the file is larger than the configured limit; the partial file is already removed. */
export class DriveFileTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The file is larger than the configured limit of ${maxBytes} bytes`)
    this.name = 'DriveFileTooLargeError'
  }
}

export interface DriveClient {
  /** The direct children of a folder, across every page of the listing. */
  listFolder(folderId: string): AsyncIterable<DriveItem>
  /** Downloads a binary file to `destPath` (mode 0600), enforcing `maxBytes` while streaming. */
  download(fileId: string, destPath: string, maxBytes: number): Promise<DownloadResult>
  /** Exports a native Google Sheet as xlsx to `destPath`, enforcing `maxBytes` while streaming. */
  exportSheet(fileId: string, destPath: string, maxBytes: number): Promise<DownloadResult>
}

/**
 * Writes a stream to `destPath` while counting its bytes and hashing it. The
 * limit is enforced on the bytes that actually arrive — not only on the size
 * the Drive reported, which native Sheets do not report at all — and a file
 * that goes over is deleted rather than left half-written on disk.
 */
export async function streamToFile(source: Readable, destPath: string, maxBytes: number): Promise<DownloadResult> {
  const hash = createHash('sha256')
  let bytes = 0

  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        callback(new DriveFileTooLargeError(maxBytes))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  try {
    await pipeline(source, guard, createWriteStream(destPath, { mode: 0o600 }))
  } catch (error) {
    await rm(destPath, { force: true })
    throw error
  }

  return { sha256: hash.digest('hex'), bytes }
}
