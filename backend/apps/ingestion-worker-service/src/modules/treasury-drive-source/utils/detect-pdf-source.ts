import type { PdfPage } from '../../treasury-ingestion/utils/pdf-text'
import type { TreasurySource } from '@app/treasury-ingestion-contracts'

function fullText(pages: PdfPage[]): string {
  return pages.map(page => page.lines.join(' ')).join(' ')
}

function matchesNubankStatement(text: string): boolean {
  return text.includes('CNPJ') && text.includes('Agência') && text.includes('Movimentações')
}

function matchesC6Invoice(text: string): boolean {
  return text.includes('Sua fatura com') || text.includes('vencimento')
}

/**
 * Content-based detection for PDF-sourced treasury files — the sibling of
 * `detectTreasurySheetSource` for sheet content. Only 2 sources are ever reached through this
 * path today: `nubank_statement` and `c6_invoice` (confirmed by real files in the "Extratos"
 * folder — PagBank's real file is a mislabeled sheet, not a real PDF; see
 * `detectTreasurySheetSource`'s own `pagbank_statement` branch instead). The bank folder still
 * narrows which signature to check, exactly like the sheet version — but never decides the
 * source by itself.
 */
export function detectTreasuryPdfSource(pages: PdfPage[], bankFolderName: string): TreasurySource | null {
  const bank = bankFolderName.trim().toLowerCase()
  const text = fullText(pages)

  if (bank === 'nubank' && matchesNubankStatement(text)) return 'nubank_statement'
  if (bank === 'c6' && matchesC6Invoice(text)) return 'c6_invoice'

  return null
}
