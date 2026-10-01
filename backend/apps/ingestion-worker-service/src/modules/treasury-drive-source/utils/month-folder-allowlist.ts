const RECOGNIZED_BANK_FOLDERS = ['itau', 'c6', 'nubank', 'pagseguro']

export function isAllowedMonthFolder(name: string, allowlist: string[]): boolean {
  const normalized = name.trim().toLowerCase()
  return allowlist.some(allowed => allowed.trim().toLowerCase() === normalized)
}

export function isRecognizedBankFolder(name: string): boolean {
  return RECOGNIZED_BANK_FOLDERS.includes(name.trim().toLowerCase())
}
