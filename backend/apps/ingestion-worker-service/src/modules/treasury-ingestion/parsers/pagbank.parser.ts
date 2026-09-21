import type { PdfPage } from '../utils/pdf-text'
import { parseStatementLines, type ParseStatementLinesResult, type StructuralPattern } from './statement-line'

/**
 * PagBank extrato bruto — "Pix enviado", "QR Code Pix enviado", "Pagamento
 * de conta" resolve as ordinary counterparty lines (no structural hint,
 * treasury-service's mapping rules decide); only the fatura line is
 * structurally always a movement, regardless of how its text varies
 * (Anexo A §3, task 3.4).
 *
 * The three recurring self-fees ("Cobrança PagBank Saúde" R$24,90/mês on
 * day 10, "Cobrança Seguro Cartão Protegido" R$7,90 and "Mensalidade Seguro
 * Conta" R$6,90 both on day 17) are PagBank's own account fees, same
 * standing as C6's "SEGURO CONTA C6" — never a favorecido to resolve via
 * mapping rules. Found live: these three always spill their amount onto a
 * continuation line with no date of its own, so before `parseStatementLines`
 * learned to join continuation lines they were silently rejected every
 * month (24 rejections across a real jan-ago/2026 backfill, R$317,60 never
 * imported) — root cause fixed there; these patterns are what classifies
 * them correctly once they DO become rows.
 *
 * jan-fev/2026 label these same three fees differently: "Pagamento com QR
 * Code - Para: PAGSEGURO INTERNET INSTITUICAO DE" / "PAGAMENTO", with no
 * text distinguishing which of the three it is — the payee is PagBank's own
 * institution, not a third-party merchant (a real QR-code payment to a
 * merchant names that merchant, e.g. "Lalamove Tecnologia Brasil Ltda."),
 * so matching on the payee alone is safe and catches all three under this
 * older wording.
 */
const PATTERNS: StructuralPattern[] = [
  { matchText: 'Cartão PagBank', kind: 'movement', category: 'Pagamento de fatura' },
  { matchText: 'Cobrança PagBank Saúde', kind: 'expense', category: 'Financeiro/Tributos' },
  { matchText: 'Cobrança Seguro Cartão Protegido', kind: 'expense', category: 'Financeiro/Tributos' },
  { matchText: 'Mensalidade Seguro Conta', kind: 'expense', category: 'Financeiro/Tributos' },
  {
    matchText: 'Pagamento com QR Code - Para: PAGSEGURO INTERNET INSTITUICAO DE',
    kind: 'expense',
    category: 'Financeiro/Tributos',
  },
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
