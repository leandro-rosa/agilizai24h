import type { DriveFileStatus, DriveValidationStatus } from '../constants/drive.constants'
import { planScanUpdate, type ExistingDriveFile, type TrackedFile } from './scan-transitions'

const file = (overrides: Partial<TrackedFile> = {}): TrackedFile => ({
  driveFileId: 'drive-1',
  name: 'Relatório_2026.xlsx',
  path: 'agosto-26',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sizeBytes: 1000,
  fingerprint: 'md5-a',
  isSynthetic: false,
  suggestion: { fileType: 'sales', period: '2026-08', note: 'generic_name' },
  ...overrides,
})

const existing = (
  status: DriveFileStatus,
  overrides: Partial<ExistingDriveFile> = {},
): ExistingDriveFile => ({
  status,
  fingerprint: 'md5-a',
  importedFingerprint: null,
  validationStatus: 'passed' as DriveValidationStatus,
  validatedFingerprint: 'md5-a',
  ...overrides,
})

describe('planScanUpdate', () => {
  describe('a file never seen before', () => {
    it('is created as new and queued for validation', () => {
      expect(planScanUpdate(null, file())).toEqual({
        action: 'create',
        status: 'new',
        resetValidation: false,
        validate: true,
        counts: 'new',
      })
    })
  })

  describe('an imported file', () => {
    it('stays imported, and is not proposed again, when its fingerprint has not changed', () => {
      const plan = planScanUpdate(existing('imported', { importedFingerprint: 'md5-a' }), file())

      expect(plan).toMatchObject({ action: 'update', status: 'imported', validate: false, counts: null, resetValidation: false })
    })

    it('becomes changed, with its validation reset, when it was edited after the import', () => {
      const plan = planScanUpdate(existing('imported', { importedFingerprint: 'md5-a' }), file({ fingerprint: 'md5-b' }))

      expect(plan).toEqual({ action: 'update', status: 'changed', resetValidation: true, validate: true, counts: 'changed' })
    })
  })

  describe('a file that went missing and came back', () => {
    it('is imported again if it is the very version that was imported', () => {
      const plan = planScanUpdate(existing('missing', { importedFingerprint: 'md5-a' }), file())

      expect(plan.status).toBe('imported')
      expect(plan.validate).toBe(false)
    })

    it('is changed if it came back different from what was imported', () => {
      const plan = planScanUpdate(existing('missing', { importedFingerprint: 'md5-a' }), file({ fingerprint: 'md5-b' }))

      expect(plan).toMatchObject({ status: 'changed', resetValidation: true, validate: true, counts: 'changed' })
    })

    it('is new if it was never imported', () => {
      const plan = planScanUpdate(existing('missing'), file())

      expect(plan).toMatchObject({ status: 'new', counts: 'new' })
    })
  })

  describe('an ignored file', () => {
    it('stays ignored while its content is unchanged', () => {
      const plan = planScanUpdate(existing('ignored'), file())

      expect(plan).toMatchObject({ status: 'ignored', validate: false, counts: null })
    })

    it('is proposed again as new when its content changed and it was never imported', () => {
      const plan = planScanUpdate(existing('ignored'), file({ fingerprint: 'md5-b' }))

      expect(plan).toMatchObject({ status: 'new', resetValidation: true, validate: true, counts: 'new' })
    })

    it('is proposed again as changed when its content changed and an earlier version was imported', () => {
      const plan = planScanUpdate(existing('ignored', { importedFingerprint: 'md5-old' }), file({ fingerprint: 'md5-b' }))

      expect(plan).toMatchObject({ status: 'changed', counts: 'changed' })
    })
  })

  describe('a file still waiting for a decision', () => {
    it.each<DriveFileStatus>(['new', 'changed'])('%s: unchanged and already validated needs nothing', status => {
      const plan = planScanUpdate(existing(status), file())

      expect(plan).toMatchObject({ status, validate: false, resetValidation: false, counts: null })
    })

    it.each<DriveFileStatus>(['new', 'changed'])('%s: edited while waiting, its validation is stale and runs again', status => {
      const plan = planScanUpdate(existing(status), file({ fingerprint: 'md5-b' }))

      expect(plan).toMatchObject({ status, resetValidation: true, validate: true, counts: null })
    })

    it('a file that was never validated is queued for validation', () => {
      const plan = planScanUpdate(existing('new', { validationStatus: 'none', validatedFingerprint: null }), file())

      expect(plan).toMatchObject({ status: 'new', validate: true })
    })

    it('a file whose validation failed is queued again', () => {
      const plan = planScanUpdate(existing('new', { validationStatus: 'failed' }), file())

      expect(plan.validate).toBe(true)
    })

    it('a validation already in progress is not queued twice', () => {
      const plan = planScanUpdate(existing('new', { validationStatus: 'validating', validatedFingerprint: null }), file())

      expect(plan.validate).toBe(false)
    })
  })

  describe('a file in error', () => {
    it('stays in error while unchanged, so a failure is not silently retried by every scan', () => {
      expect(planScanUpdate(existing('error'), file())).toMatchObject({ status: 'error', validate: false })
    })

    it('gets a fresh chance as new when the file changed', () => {
      expect(planScanUpdate(existing('error'), file({ fingerprint: 'md5-b' }))).toMatchObject({
        status: 'new',
        resetValidation: true,
        validate: true,
      })
    })
  })

  describe('a file being imported', () => {
    it('is never touched by a scan, even if it changed underneath', () => {
      const plan = planScanUpdate(existing('importing'), file({ fingerprint: 'md5-b' }))

      expect(plan).toMatchObject({ status: 'importing', resetValidation: false, validate: false, counts: null })
    })
  })
})
