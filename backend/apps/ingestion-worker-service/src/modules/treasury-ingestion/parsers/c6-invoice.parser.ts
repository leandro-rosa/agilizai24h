import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { PdfPage } from '../utils/pdf-text'
import { monthFromPtAbbreviation, resolveYearFromPeriod } from '../utils/date'
import { findBareMoneyInText } from '../utils/money'
import { normalizeForMatch } from '../utils/normalize'
import type { ParseStatementLinesResult } from './statement-line'

/**
 * Real shape (measured 2026-08, design.md D9): `DD mmm <description> <bare amount>` — no
 * slashes, no year (the "mmm" is a lowercase 3-letter PT abbreviation, e.g. "01 abr"), and no
 * `R$` on a purchase line at all (only on card-level subtotal lines, which don't start with a
 * date and so are already excluded by this pattern).
 */
const LINE_DATE_PATTERN = /^(\d{2})\s+([a-zà-ú]{3})\s+(.*)$/i
const INSTALLMENT_PATTERN = /\bParcela\s+(\d+)\s*\/\s*(\d+)\b/i
/** Same shape `findBareMoneyInText` matches — kept local so the description can be cut at the
 * match's START, dropping everything from the amount onward (a Refinanciamento line carries
 * Juros/IOF detail in a tab-separated tail AFTER the amount that must not end up in
 * `counterpartyRaw`), not just have the amount substring removed from wherever it sits. */
const BARE_AMOUNT_PATTERN = /(-)?\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/

/**
 * C6 Business invoice — the one source where the line ITSELF says whether
 * it's a compra, a pagamento, or a refinanciamento, regardless of who the
 * favorecido is (Anexo A §4, task 3.6):
 *
 * - "Inclusão de Pagamento" / "Pagamento Fatura QR CODE" → movement:
 *   quitação da dívida, never a new expense.
 * - "Refinanciamento Fatura - Parcela X/Y" → expense, Financeiro/Tributos:
 *   juros/IOF embutido, not a new compra.
 * - everything else is an ordinary compra — including cartão adicional
 *   lines (e.g. "C6 Business Final XXXX - BARBARA O FERNANDES"), which get
 *   no special treatment: same analysis as the cartão principal.
 *
 * `period` (the uploader-stated `YYYY-MM`) resolves the year no purchase
 * line states itself — see `resolveYearFromPeriod`.
 */
export function parseC6Invoice(pages: PdfPage[], period: string): ParseStatementLinesResult {
  const rows: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  for (const page of pages) {
    page.lines.forEach((line, lineIndex) => {
      const rowReference = `p${page.pageNumber}L${lineIndex + 1}`
      const dateMatch = LINE_DATE_PATTERN.exec(line)
      if (!dateMatch) return

      const [, day, monthAbbreviation, rest] = dateMatch
      const month = monthFromPtAbbreviation(monthAbbreviation)
      if (month === null) return // "mmm"-shaped but not a real PT abbreviation — not a date line

      const occurredOn = resolveYearFromPeriod(Number(day), month, period)
      if (!occurredOn) {
        rejections.push({ rowReference, reason: 'unparseable_date', detail: `"${day} ${monthAbbreviation}" is not a valid date` })
        return
      }

      const money = findBareMoneyInText(rest)
      if (!money) {
        rejections.push({
          rowReference,
          reason: 'unparseable_amount',
          detail: `Line has a date but no recognisable amount: "${line}"`,
        })
        return
      }

      // The amount is followed by a tab and extra detail on a
      // Refinanciamento line ("1.372,66\tJuros: R$ 1.427,90 | IOF: R$
      // 1.691,12") — cut the description at where the amount STARTS,
      // dropping that trailing detail along with the amount itself.
      const amountMatch = BARE_AMOUNT_PATTERN.exec(rest)
      const description = (amountMatch ? rest.slice(0, amountMatch.index) : rest).trim()
      const normalized = normalizeForMatch(description)
      const installmentMatch = INSTALLMENT_PATTERN.exec(description)

      const isPayment = normalized.includes('INCLUSAO DE PAGAMENTO') || normalized.includes('PAGAMENTO FATURA')
      const isRefinancing = normalized.includes('REFINANCIAMENTO FATURA')

      rows.push({
        occurredOn,
        amountCents: money.amountCents,
        // A fatura's own lines are debits (compras) or credits (pagamentos)
        // depending on the section, not on a signed amount in the source
        // text — a payment reduces the fatura, so it is the inflow side of
        // this specific document even though real money left the checking
        // account (that departure is its own line on the checking
        // statement, already classified as `movement` there).
        direction: isPayment ? 'inflow' : 'outflow',
        counterpartyRaw: description,
        sourceRef: rowReference,
        ...(installmentMatch
          ? { installmentIndex: Number(installmentMatch[1]), installmentTotal: Number(installmentMatch[2]) }
          : {}),
        ...(isPayment
          ? { structuralHint: { kind: 'movement' as const, category: 'Pagamento de fatura' } }
          : isRefinancing
            ? { structuralHint: { kind: 'expense' as const, category: 'Financeiro/Tributos' } }
            : {}),
      })
    })
  }

  return { rows, rejections }
}
