import { detectTreasuryPdfSource } from './detect-pdf-source'
import type { PdfPage } from '../../treasury-ingestion/utils/pdf-text'

function pages(lines: string[]): PdfPage[] {
  return [{ pageNumber: 1, lines }]
}

describe('detectTreasuryPdfSource', () => {
  it('detects a Nubank statement by its real header text, in the nubank folder', () => {
    const lines = ['AGILIZ.AI LTDA', '60.819.321/0001-44 0001\tCNPJ Agência Conta', 'Movimentações']
    expect(detectTreasuryPdfSource(pages(lines), 'nubank')).toBe('nubank_statement')
  })

  it('detects a C6 invoice by its real greeting text, in the c6 folder', () => {
    const lines = ['Olá, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou', 'no valor de R$ 16.623,15.']
    expect(detectTreasuryPdfSource(pages(lines), 'c6')).toBe('c6_invoice')
  })

  it('returns null for PDF content matching no known signature', () => {
    expect(detectTreasuryPdfSource(pages(['Something unrelated']), 'nubank')).toBeNull()
  })

  it('returns null when the bank folder is not one this function recognizes for PDF content', () => {
    const lines = ['Olá, AGILIZ.AI LTDA! Sua fatura com', 'vencimento em Outubro chegou']
    expect(detectTreasuryPdfSource(pages(lines), 'pagseguro')).toBeNull()
  })
})
