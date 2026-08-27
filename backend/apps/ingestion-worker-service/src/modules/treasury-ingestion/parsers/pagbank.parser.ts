import type { PdfPage } from '../utils/pdf-text'
import { parseStatementLines, type ParseStatementLinesResult, type StructuralPattern } from './statement-line'

/**
 * PagBank extrato bruto — "Pix enviado", "QR Code Pix enviado", "Pagamento
 * de conta" resolve as ordinary counterparty lines (no structural hint,
 * treasury-service's mapping rules decide); only the fatura line is
 * structurally always a movement, regardless of how its text varies
 * (Anexo A §3, task 3.4).
 */
const PATTERNS: StructuralPattern[] = [
  { matchText: 'Cartão PagBank', kind: 'movement', category: 'Pagamento de fatura' },
]

/**
 * Anexo A §3 names these for saídas; the "recebido" pair isn't spelled out
 * there but is the obvious mirror of PagBank's own "enviado" wording, so
 * it's included on the same footing as the rest of this parser's layout
 * assumption — unmeasured against a real statement (CLAUDE.md gap).
 */
const VERB_PREFIXES = ['Pix enviado', 'Pix recebido', 'QR Code Pix enviado', 'QR Code Pix recebido', 'Pagamento de conta']

export function parsePagBankStatement(pages: PdfPage[]): ParseStatementLinesResult {
  const rows: ParseStatementLinesResult['rows'] = []
  const rejections: ParseStatementLinesResult['rejections'] = []

  for (const page of pages) {
    const result = parseStatementLines(page.pageNumber, page.lines, PATTERNS, VERB_PREFIXES)
    rows.push(...result.rows)
    rejections.push(...result.rejections)
  }

  return { rows, rejections }
}
