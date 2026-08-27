import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { PdfPage } from '../utils/pdf-text'
import { parseBrDate } from '../utils/date'
import { parseBrlAmountToCents } from '../utils/money'
import { normalizeForMatch } from '../utils/normalize'
import type { ParseStatementLinesResult } from './statement-line'

/**
 * PagSeguro/PagBank card invoice ("Histórico de movimentações") — the 7th
 * source (design.md D11), discovered while validating the original six
 * against real files: a genuinely distinct file from the PagBank checking-
 * account statement, with its own inverted line shape (measured 2026-08):
 * `<description> <bare amount>\t<DD/MM/YYYY>` — the date comes LAST, not
 * first, and the amount carries no `R$` marker. Real example:
 * `"DISTRIBUIDORA MARSIL - Parc.2/2 863,27\t18/11/2025"`.
 */
const LINE_PATTERN = /^(.+?)\s+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\t(\d{2})\/(\d{2})\/(\d{4})\s*$/
const INSTALLMENT_PATTERN = /\bParc(?:ela)?\.?\s*(\d+)\s*\/\s*(\d+)\b/i

/** Mirrors the C6 invoice's own compra/pagamento split (Anexo A §4) — a payment line
 * quitting the fatura is a movement, never a new expense. */
function isPayment(normalizedDescription: string): boolean {
  return normalizedDescription.includes('PAGAMENTO DE FATURA') || normalizedDescription.includes('PAGAMENTO FATURA')
}

export function parsePagSeguroInvoice(pages: PdfPage[]): ParseStatementLinesResult {
  const rows: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  for (const page of pages) {
    page.lines.forEach((line, lineIndex) => {
      const rowReference = `p${page.pageNumber}L${lineIndex + 1}`
      const match = LINE_PATTERN.exec(line)
      if (!match) return // not every line is a transaction — headers, boilerplate, and the "Total despesas" footer never end in a tab + date

      const [, description, amountText, day, month, year] = match
      const occurredOn = parseBrDate(day, month, year)
      if (!occurredOn) {
        rejections.push({ rowReference, reason: 'unparseable_date', detail: `"${day}/${month}/${year}" is not a valid date` })
        return
      }

      const amountCents = parseBrlAmountToCents(amountText)
      if (amountCents === null) {
        rejections.push({ rowReference, reason: 'unparseable_amount', detail: `"${amountText}" is not a recognisable amount` })
        return
      }

      const trimmedDescription = description.trim()
      const normalizedDescription = normalizeForMatch(trimmedDescription)
      const installmentMatch = INSTALLMENT_PATTERN.exec(trimmedDescription)
      const payment = isPayment(normalizedDescription)

      rows.push({
        occurredOn,
        amountCents,
        // Same reasoning as the C6 invoice: a payment reduces the fatura,
        // so it is the inflow side of THIS document even though real money
        // left the checking account (that departure is its own, separately
        // classified `movement` line on whichever statement paid it).
        direction: payment ? 'inflow' : 'outflow',
        counterpartyRaw: trimmedDescription,
        sourceRef: rowReference,
        ...(installmentMatch
          ? { installmentIndex: Number(installmentMatch[1]), installmentTotal: Number(installmentMatch[2]) }
          : {}),
        ...(payment ? { structuralHint: { kind: 'movement' as const, category: 'Pagamento de fatura' } } : {}),
      })
    })
  }

  return { rows, rejections }
}
