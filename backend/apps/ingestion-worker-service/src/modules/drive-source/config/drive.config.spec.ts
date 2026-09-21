import { loadDriveConfig } from './drive.config'

const SERVICE_ACCOUNT = { client_email: 'reader@project.iam.gserviceaccount.com', private_key: 'not-a-real-key' }
const asBase64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64')

const configured = (extra: Record<string, unknown> = {}) => ({
  GOOGLE_DRIVE_ROOT_FOLDER_ID: 'folder-id',
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: asBase64(SERVICE_ACCOUNT),
  ...extra,
})

describe('loadDriveConfig', () => {
  describe('optional and inert when unconfigured', () => {
    it('is disabled, with every documented default, when nothing is set', () => {
      const config = loadDriveConfig({})

      expect(config.enabled).toBe(false)
      expect(config.rootFolderId).toBeUndefined()
      expect(config.scanCron).toBe('0 6 * * *')
      expect(config.autoValidate).toBe(true)
      expect(config.maxFileBytes).toBe(25 * 1024 * 1024)
      expect(config.includePatterns).toEqual(['relat[oó]rio', 'abasteciment'])
      expect(config.thresholds).toEqual({
        periodMatchMinShare: 0.9,
        weekdayOpenMinShare: 0.5,
        coverageMinPooled: 0.9,
        coverageMinStore: 0.7,
        edgeToleranceDays: 3,
      })
    })

    it('treats empty strings as unset, the way an .env file with a blank value behaves', () => {
      expect(loadDriveConfig({ GOOGLE_DRIVE_ROOT_FOLDER_ID: '', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: '   ' }).enabled).toBe(false)
    })
  })

  describe('all-or-nothing credentials', () => {
    it('is enabled when the folder id and a base64 credential are both present', () => {
      const config = loadDriveConfig(configured())

      expect(config.enabled).toBe(true)
      expect(config.rootFolderId).toBe('folder-id')
      expect(config.credential?.kind).toBe('base64')
    })

    it('is enabled with a credential file instead', () => {
      const config = loadDriveConfig(
        { GOOGLE_DRIVE_ROOT_FOLDER_ID: 'folder-id', GOOGLE_SERVICE_ACCOUNT_FILE: '/run/secrets/drive.json' },
        () => true,
      )

      expect(config.enabled).toBe(true)
      expect(config.credential).toEqual({ kind: 'file', path: '/run/secrets/drive.json' })
    })

    it('fails naming the missing credential when only the folder id is set', () => {
      expect(() => loadDriveConfig({ GOOGLE_DRIVE_ROOT_FOLDER_ID: 'folder-id' })).toThrow(
        /GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_SERVICE_ACCOUNT_FILE/,
      )
    })

    it('fails naming the missing folder id when only a credential is set', () => {
      expect(() => loadDriveConfig({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: asBase64(SERVICE_ACCOUNT) })).toThrow(
        /GOOGLE_DRIVE_ROOT_FOLDER_ID/,
      )
    })

    it('fails when both credential forms are set, so it is never ambiguous which one is used', () => {
      expect(() =>
        loadDriveConfig(configured({ GOOGLE_SERVICE_ACCOUNT_FILE: '/run/secrets/drive.json' }), () => true),
      ).toThrow(/only one of/)
    })

    it('fails when the credential file does not exist', () => {
      expect(() =>
        loadDriveConfig({ GOOGLE_DRIVE_ROOT_FOLDER_ID: 'f', GOOGLE_SERVICE_ACCOUNT_FILE: '/nope.json' }, () => false),
      ).toThrow(/GOOGLE_SERVICE_ACCOUNT_FILE.*not found/)
    })
  })

  describe('the credential is never echoed', () => {
    it('reports a malformed base64 credential by variable name only', () => {
      const secretLooking = 'AAAA-this-should-never-appear-in-an-error'

      expect(() => loadDriveConfig(configured({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: secretLooking }))).toThrow(
        /GOOGLE_SERVICE_ACCOUNT_JSON_BASE64/,
      )
      try {
        loadDriveConfig(configured({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: secretLooking }))
      } catch (error) {
        expect((error as Error).message).not.toContain(secretLooking)
      }
    })

    it('rejects a credential without the fields a service account key must have', () => {
      expect(() =>
        loadDriveConfig(configured({ GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: asBase64({ type: 'service_account' }) })),
      ).toThrow(/client_email and private_key/)
    })
  })

  describe('settings', () => {
    it('reads a raised size limit as configured', () => {
      expect(loadDriveConfig({ DRIVE_MAX_FILE_BYTES: String(40 * 1024 * 1024) }).maxFileBytes).toBe(40 * 1024 * 1024)
    })

    it('accepts numbers as well as strings, since ConfigService hands back converted values', () => {
      expect(loadDriveConfig({ DRIVE_MAX_FILE_BYTES: 1024, DRIVE_EDGE_TOLERANCE_DAYS: 5 }).maxFileBytes).toBe(1024)
      expect(loadDriveConfig({ DRIVE_EDGE_TOLERANCE_DAYS: 5 }).thresholds.edgeToleranceDays).toBe(5)
    })

    it('switches automatic validation off with false', () => {
      expect(loadDriveConfig({ DRIVE_AUTO_VALIDATE: 'false' }).autoValidate).toBe(false)
      expect(loadDriveConfig({ DRIVE_AUTO_VALIDATE: 'true' }).autoValidate).toBe(true)
    })

    it('overrides every validation threshold', () => {
      const { thresholds } = loadDriveConfig({
        DRIVE_PERIOD_MATCH_MIN_SHARE: '0.95',
        DRIVE_WEEKDAY_OPEN_MIN_SHARE: '0.4',
        DRIVE_COVERAGE_MIN_POOLED: '0.85',
        DRIVE_COVERAGE_MIN_STORE: '0.6',
        DRIVE_EDGE_TOLERANCE_DAYS: '2',
      })

      expect(thresholds).toEqual({
        periodMatchMinShare: 0.95,
        weekdayOpenMinShare: 0.4,
        coverageMinPooled: 0.85,
        coverageMinStore: 0.6,
        edgeToleranceDays: 2,
      })
    })

    it.each([
      ['DRIVE_PERIOD_MATCH_MIN_SHARE', '0'],
      ['DRIVE_PERIOD_MATCH_MIN_SHARE', '1.5'],
      ['DRIVE_COVERAGE_MIN_STORE', '-0.1'],
      ['DRIVE_WEEKDAY_OPEN_MIN_SHARE', 'abc'],
    ])('rejects %s = %s, a share must be in (0, 1]', (name, value) => {
      expect(() => loadDriveConfig({ [name]: value })).toThrow(new RegExp(name))
    })

    it.each([
      ['DRIVE_MAX_FILE_BYTES', '0'],
      ['DRIVE_MAX_FILE_BYTES', '-5'],
      ['DRIVE_EDGE_TOLERANCE_DAYS', '-1'],
      ['DRIVE_EDGE_TOLERANCE_DAYS', '2.5'],
    ])('rejects %s = %s', (name, value) => {
      expect(() => loadDriveConfig({ [name]: value })).toThrow(new RegExp(name))
    })

    it('rejects a pattern that is not a valid regular expression, naming the variable', () => {
      expect(() => loadDriveConfig({ DRIVE_INCLUDE_PATTERNS: 'ok,(unclosed' })).toThrow(/DRIVE_INCLUDE_PATTERNS/)
      expect(() => loadDriveConfig({ DRIVE_SYNTHETIC_PATTERN: '[' })).toThrow(/DRIVE_SYNTHETIC_PATTERN/)
    })

    it('splits include patterns on commas and drops blanks', () => {
      expect(loadDriveConfig({ DRIVE_INCLUDE_PATTERNS: ' relat , ,abast ' }).includePatterns).toEqual(['relat', 'abast'])
    })

    it('rejects a cron expression that does not have five or six fields', () => {
      expect(() => loadDriveConfig({ DRIVE_SCAN_CRON: 'every day' })).toThrow(/DRIVE_SCAN_CRON/)
      expect(loadDriveConfig({ DRIVE_SCAN_CRON: '30 5 * * 1-5' }).scanCron).toBe('30 5 * * 1-5')
    })
  })
})
