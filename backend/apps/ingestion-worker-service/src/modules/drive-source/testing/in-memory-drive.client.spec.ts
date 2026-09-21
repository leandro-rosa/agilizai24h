import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryDriveClient } from './in-memory-drive.client'

const listAll = async (client: InMemoryDriveClient, folder: string) => {
  const items = []
  for await (const item of client.listFolder(folder)) items.push(item)
  return items
}

describe('InMemoryDriveClient', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-drive-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const tree = () =>
    InMemoryDriveClient.fromTree('root', {
      'agosto-26': { 'Relatório_2026.xlsx': 'aug-report', 'venda Ascenty - ADM agosto.xlsx': 'legacy' },
      'julho-26': { 'Abastecimentos 2026-07-01 _ 2026-07-31.xlsx': 'jul-supply', Planilha: { sheet: 'native' } },
    })

  it('lists folders and files as metadata, and reading them downloads nothing', async () => {
    const client = tree()

    const root = await listAll(client, 'root')
    const august = await listAll(client, root.find(i => i.name === 'agosto-26')!.id)

    expect(root.map(i => [i.name, i.isFolder])).toEqual([['agosto-26', true], ['julho-26', true]])
    expect(august.map(i => i.name)).toEqual(['Relatório_2026.xlsx', 'venda Ascenty - ADM agosto.xlsx'])
    expect(client.downloaded).toEqual([])
    expect(client.exported).toEqual([])
  })

  it('gives a binary file a size and an md5, and a native sheet neither', async () => {
    const client = tree()
    const july = (await listAll(client, 'root')).find(i => i.name === 'julho-26')!
    const [supply, sheet] = await listAll(client, july.id)

    expect(supply).toMatchObject({ size: 10, md5Checksum: expect.any(String) })
    expect(sheet).toMatchObject({ size: null, md5Checksum: null, mimeType: 'application/vnd.google-apps.spreadsheet' })
  })

  it('records and serves content only when it is downloaded or exported', async () => {
    const client = tree()
    const august = (await listAll(client, 'root')).find(i => i.name === 'agosto-26')!
    const [report] = await listAll(client, august.id)

    const result = await client.download(report.id, join(dir, 'r.xlsx'), 1024)

    expect(readFileSync(join(dir, 'r.xlsx'), 'utf8')).toBe('aug-report')
    expect(result.bytes).toBe(10)
    expect(client.downloaded).toEqual([report.id])
  })

  it('changes checksum and version when a file is edited, and only the version when it is touched', async () => {
    const client = tree()
    const august = (await listAll(client, 'root')).find(i => i.name === 'agosto-26')!
    const [before] = await listAll(client, august.id)

    client.touch(before.id)
    const [touched] = await listAll(client, august.id)
    client.edit(before.id, 'corrected')
    const [edited] = await listAll(client, august.id)

    expect(touched.md5Checksum).toBe(before.md5Checksum)
    expect(touched.version).not.toBe(before.version)
    expect(edited.md5Checksum).not.toBe(before.md5Checksum)
  })

  it('can fail the listing of one folder only, so a scan can break halfway', async () => {
    const client = tree()
    client.failListingOfFolder('julho-26', new Error('quota exceeded'))
    const root = await listAll(client, 'root')

    expect(await listAll(client, root.find(i => i.name === 'agosto-26')!.id)).toHaveLength(2)
    await expect(listAll(client, root.find(i => i.name === 'julho-26')!.id)).rejects.toThrow('quota exceeded')
  })

  it('hides trashed and removed files and can fail a listing or a download on demand', async () => {
    const client = tree()
    const august = (await listAll(client, 'root')).find(i => i.name === 'agosto-26')!
    const [report, legacy] = await listAll(client, august.id)

    client.trash(legacy.id)
    expect((await listAll(client, august.id)).map(i => i.id)).toEqual([report.id])

    client.failDownload(report.id, new Error('quota exceeded'))
    await expect(client.download(report.id, join(dir, 'x'), 1024)).rejects.toThrow('quota exceeded')

    client.failListing()
    await expect(listAll(client, 'root')).rejects.toThrow(/no longer shared/)
  })
})
