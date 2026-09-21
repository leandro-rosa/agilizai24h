import type { DownloadResult, DriveClient, DriveItem } from './drive-client'

/** Stands in for the Drive when the source is not configured: the app boots, and any use of it says why it cannot work. */
export class DisabledDriveClient implements DriveClient {
  // eslint-disable-next-line require-yield
  async *listFolder(): AsyncIterable<DriveItem> {
    throw new Error('The Drive source is not configured')
  }

  async download(): Promise<DownloadResult> {
    throw new Error('The Drive source is not configured')
  }

  async exportSheet(): Promise<DownloadResult> {
    throw new Error('The Drive source is not configured')
  }
}
