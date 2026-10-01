import { isAllowedMonthFolder, isRecognizedBankFolder } from './month-folder-allowlist'

describe('isAllowedMonthFolder', () => {
  it('matches a name in the allowlist, case-insensitively', () => {
    expect(isAllowedMonthFolder('Agosto', ['agosto', 'setembro'])).toBe(true)
    expect(isAllowedMonthFolder('agosto', ['agosto', 'setembro'])).toBe(true)
  })

  it('does not match a real month name outside the allowlist (e.g. julho, present in the real Drive tree but before the cutover)', () => {
    expect(isAllowedMonthFolder('julho', ['agosto', 'setembro'])).toBe(false)
  })

  it('does not match an unrelated folder name (legacy items like "Cartões" or a bank-prefixed multi-month folder)', () => {
    expect(isAllowedMonthFolder('Cartões', ['agosto'])).toBe(false)
    expect(isAllowedMonthFolder('nubank janeiro a agosto', ['agosto'])).toBe(false)
  })
})

describe('isRecognizedBankFolder', () => {
  it('recognizes itau and c6, case-insensitively', () => {
    expect(isRecognizedBankFolder('itau')).toBe(true)
    expect(isRecognizedBankFolder('C6')).toBe(true)
  })

  it('does not recognize a bank not covered by this phase', () => {
    expect(isRecognizedBankFolder('bradesco')).toBe(false)
  })

  it('does not recognize a non-bank folder (noise like "comprovantes itau" living at the wrong level)', () => {
    expect(isRecognizedBankFolder('comprovantes itau')).toBe(false)
  })

  describe('isRecognizedBankFolder — multi-bank', () => {
    it('recognizes nubank and pagseguro, case-insensitively', () => {
      expect(isRecognizedBankFolder('nubank')).toBe(true)
      expect(isRecognizedBankFolder('PagSeguro')).toBe(true)
    })

    it('still does not recognize bradesco — no real file to verify against yet', () => {
      expect(isRecognizedBankFolder('bradesco')).toBe(false)
    })
  })
})
