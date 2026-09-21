import { loadDriveConfig } from '../config/drive.config'
import { DriveValidationService } from './drive-validation.service'

jest.mock('../../ingestion/utils/read-workbook-rows', () => ({ readWorkbookRows: jest.fn() }))
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readWorkbookRows } = require('../../ingestion/utils/read-workbook-rows') as { readWorkbookRows: jest.Mock }

const config = loadDriveConfig({
  GOOGLE_DRIVE_ROOT_FOLDER_ID: 'root',
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({ client_email: 'a@b.c', private_key: 'k' })).toString('base64'),
})

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'file-1',
  drive_file_id: 'drive-1',
  name: 'Relatório_2026.xlsx',
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 1000,
  fingerprint: 'md5-a',
  status: 'new',
  is_synthetic: false,
  suggested_file_type: 'sales',
  suggested_period: '2026-08',
  validation_report: null,
  validated_fingerprint: null,
  content_sha256: null,
  imported_sha256: null,
  ...overrides,
})

const build = (fileRow = row()) => {
  const repository = {
    findById: jest.fn().mockResolvedValue(fileRow),
    update: jest.fn().mockResolvedValue(undefined),
    findImportedByContent: jest.fn().mockResolvedValue(null),
  }
  const drive = {
    download: jest.fn().mockResolvedValue({ sha256: 'abc', bytes: 1000 }),
    exportSheet: jest.fn().mockResolvedValue({ sha256: 'abc', bytes: 1000 }),
    listFolder: jest.fn(),
  }
  return { repository, drive, service: new DriveValidationService(config, drive as never, repository as never) }
}

describe('DriveValidationService — the branches a real file cannot reach', () => {
  it('blocks a file its reader cannot open, as unreadable, and stores that instead of failing the job', async () => {
    readWorkbookRows.mockRejectedValue(new Error('corrupt zip'))
    const { service, repository } = build()

    const report = await service.validate('file-1')

    expect(report?.outcome).toBe('blocked')
    expect(report?.blocking).toEqual([expect.objectContaining({ code: 'unreadable_file' })])
    expect(repository.update).toHaveBeenLastCalledWith('file-1', expect.objectContaining({ validation_status: 'blocked' }))
  })

  it('exports a native Google Sheet instead of downloading it', async () => {
    readWorkbookRows.mockResolvedValue([])
    const { service, drive } = build(row({ mime_type: 'application/vnd.google-apps.spreadsheet', name: 'Relatório_2026', size_bytes: null }))

    await service.validate('file-1')

    expect(drive.exportSheet).toHaveBeenCalledTimes(1)
    expect(drive.download).not.toHaveBeenCalled()
  })

  it('does nothing for a file that no longer exists', async () => {
    const { service, repository, drive } = build()
    repository.findById.mockResolvedValue(null)

    expect(await service.validate('gone')).toBeNull()
    expect(drive.download).not.toHaveBeenCalled()
  })
})
