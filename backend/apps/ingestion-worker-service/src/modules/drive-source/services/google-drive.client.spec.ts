import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { DriveFileTooLargeError } from './drive-client'
import { GoogleDriveClient, type DriveApi } from './google-drive.client'

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

const rawFile = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  name: 'Relatório_2026.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: '1234',
  md5Checksum: 'abc',
  modifiedTime: '2026-09-02T11:32:00.000Z',
  version: '7',
  parents: ['month-folder'],
  trashed: false,
  ...overrides,
})

const stubApi = (pages: Record<string, unknown>[][], content = 'file-bytes') => {
  const list = jest.fn(async (params: { pageToken?: string }) => {
    const index = params.pageToken ? Number(params.pageToken) : 0
    return {
      data: {
        files: pages[index],
        nextPageToken: index + 1 < pages.length ? String(index + 1) : undefined,
      },
    }
  })
  const get = jest.fn(async () => ({ data: Readable.from([Buffer.from(content)]) }))
  const exportFile = jest.fn(async () => ({ data: Readable.from([Buffer.from(content)]) }))
  const api = { files: { list, get, export: exportFile } } as unknown as DriveApi

  return { api, list, get, exportFile }
}

const collect = async (client: GoogleDriveClient, folder: string) => {
  const items = []
  for await (const item of client.listFolder(folder)) items.push(item)
  return items
}

describe('GoogleDriveClient', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drive-client-spec-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('listFolder', () => {
    it('follows every page of the listing', async () => {
      const { api, list } = stubApi([[rawFile({ id: 'a' })], [rawFile({ id: 'b' })], [rawFile({ id: 'c' })]])

      const items = await collect(new GoogleDriveClient(api), 'root-folder')

      expect(items.map(item => item.id)).toEqual(['a', 'b', 'c'])
      expect(list).toHaveBeenCalledTimes(3)
    })

    it('asks only for metadata, in My Drive and shared drives alike, and never for trashed items', async () => {
      const { api, list } = stubApi([[]])

      await collect(new GoogleDriveClient(api), 'root-folder')

      const params = list.mock.calls[0][0] as Record<string, unknown>
      expect(params.q).toBe("'root-folder' in parents and trashed = false")
      expect(params.supportsAllDrives).toBe(true)
      expect(params.includeItemsFromAllDrives).toBe(true)
      expect(params.fields).toContain('md5Checksum')
      expect(params.fields).toContain('modifiedTime')
      expect(params.fields).not.toMatch(/webContentLink|exportLinks|thumbnail/)
    })

    it('maps the Drive fields, turning the size string into a number and missing values into null', async () => {
      const { api } = stubApi([
        [
          rawFile(),
          rawFile({ id: 'sheet', mimeType: 'application/vnd.google-apps.spreadsheet', size: undefined, md5Checksum: undefined, version: undefined }),
          rawFile({ id: 'folder', mimeType: 'application/vnd.google-apps.folder', size: undefined, md5Checksum: undefined }),
        ],
      ])

      const [file, sheet, folder] = await collect(new GoogleDriveClient(api), 'root')

      expect(file).toMatchObject({ id: 'f1', size: 1234, md5Checksum: 'abc', version: '7', isFolder: false, trashed: false })
      expect(sheet).toMatchObject({ id: 'sheet', size: null, md5Checksum: null, version: null, isFolder: false })
      expect(folder).toMatchObject({ id: 'folder', isFolder: true })
    })

    it('drops trashed items even if the Drive returns them', async () => {
      const { api } = stubApi([[rawFile({ id: 'live' }), rawFile({ id: 'gone', trashed: true })]])

      expect((await collect(new GoogleDriveClient(api), 'root')).map(i => i.id)).toEqual(['live'])
    })

    it.each([["x' or name contains 'y"], ['a b'], ['']])(
      'refuses a folder id that could alter the query: %j',
      async badId => {
        const { api, list } = stubApi([[]])

        await expect(collect(new GoogleDriveClient(api), badId)).rejects.toThrow(/folder id/i)
        expect(list).not.toHaveBeenCalled()
      },
    )
  })

  describe('download', () => {
    it('writes the bytes, reports their SHA-256 and the size, and restricts the file to its owner', async () => {
      const { api, get } = stubApi([[]], 'the-report-bytes')
      const dest = join(dir, 'report.xlsx')

      const result = await new GoogleDriveClient(api).download('f1', dest, 1024)

      expect(result).toEqual({ sha256: sha256('the-report-bytes'), bytes: 16 })
      expect(readFileSync(dest, 'utf8')).toBe('the-report-bytes')
      expect(statSync(dest).mode & 0o777).toBe(0o600)
      expect(get).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f1', alt: 'media', supportsAllDrives: true }), { responseType: 'stream' })
    })

    it('enforces the limit on the bytes that arrive and deletes the partial file', async () => {
      const { api } = stubApi([[]], 'x'.repeat(100))
      const dest = join(dir, 'big.xlsx')

      await expect(new GoogleDriveClient(api).download('f1', dest, 50)).rejects.toBeInstanceOf(DriveFileTooLargeError)
      expect(existsSync(dest)).toBe(false)
    })

    it('accepts a file that is exactly at the limit', async () => {
      const { api } = stubApi([[]], 'x'.repeat(50))

      await expect(new GoogleDriveClient(api).download('f1', join(dir, 'exact.xlsx'), 50)).resolves.toMatchObject({ bytes: 50 })
    })
  })

  describe('exportSheet', () => {
    it('exports a native Google Sheet as xlsx, with the same limit and hash', async () => {
      const { api, exportFile } = stubApi([[]], 'exported')
      const dest = join(dir, 'sheet.xlsx')

      const result = await new GoogleDriveClient(api).exportSheet('sheet-id', dest, 1024)

      expect(result.sha256).toBe(sha256('exported'))
      expect(exportFile).toHaveBeenCalledWith(
        { fileId: 'sheet-id', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { responseType: 'stream' },
      )
    })

    it('deletes an export that goes over the limit', async () => {
      const { api } = stubApi([[]], 'x'.repeat(100))
      const dest = join(dir, 'sheet.xlsx')

      await expect(new GoogleDriveClient(api).exportSheet('s', dest, 10)).rejects.toBeInstanceOf(DriveFileTooLargeError)
      expect(existsSync(dest)).toBe(false)
    })
  })
})
