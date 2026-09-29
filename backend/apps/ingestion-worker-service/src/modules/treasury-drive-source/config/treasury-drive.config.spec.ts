import { loadTreasuryDriveConfig } from './treasury-drive.config'

describe('loadTreasuryDriveConfig', () => {
  const validCredential = Buffer.from(JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x' })).toString('base64')

  it('is disabled when neither the folder nor the credential is set', () => {
    const config = loadTreasuryDriveConfig({})
    expect(config.enabled).toBe(false)
  })

  it('is enabled when both the folder and a valid credential are set', () => {
    const config = loadTreasuryDriveConfig({
      TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
    })
    expect(config.enabled).toBe(true)
    expect(config.rootFolderId).toBe('folder-1')
  })

  it('parses the month-folder allowlist from a comma-separated string, trimmed', () => {
    const config = loadTreasuryDriveConfig({
      TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
      TREASURY_DRIVE_MONTH_FOLDERS: 'agosto, setembro ,outubro',
    })
    expect(config.monthFolders).toEqual(['agosto', 'setembro', 'outubro'])
  })

  it('defaults the month-folder allowlist to an empty list, never guessing one', () => {
    const config = loadTreasuryDriveConfig({
      TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1',
      GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential,
    })
    expect(config.monthFolders).toEqual([])
  })

  it('defaults scanCron to the same 06:00 America/Sao_Paulo schedule sales/abastecimento uses', () => {
    const config = loadTreasuryDriveConfig({ TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: validCredential })
    expect(config.scanCron).toBe('0 6 * * *')
  })

  it('throws naming the problem when the credential is malformed', () => {
    expect(() =>
      loadTreasuryDriveConfig({ TREASURY_DRIVE_ROOT_FOLDER_ID: 'folder-1', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: 'not-base64-json' }),
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON_BASE64/)
  })
})
