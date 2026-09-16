import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { PdfPage } from '../utils/pdf-text'
import { parseBrDate } from '../utils/date'
import { findBareMoneyInText } from '../utils/money'
import { normalizeForMatch } from '../utils/normalize'
import type { ParseStatementLinesResult, StructuralPattern } from './statement-line'

/**
 * Itaú extrato resumido — "SISPAG PAGAMENTO DE FORNECEDOR" (also seen as
 * "SISPAG FORNECEDORES") carries no payee in the statement at all. Forced to
 * `kind: pending` explicitly, rather than left to fall through to mapping
 * resolution naturally failing to match generic SISPAG text: the spec is
 * explicit that no fornecedor may be GUESSED for this line, and an explicit
 * hint is what makes that a stated rule instead of an accident of what
 * mapping rules happen to exist (spec: "Itaú SISPAG lines are staged as
 * pending, never assigned a guessed payee").
 *
 * Every other Itaú line (receita via PIX QR Code de cliente final,
 * "Recebimento Rede") is ordinary and resolves through mapping rules like
 * any other source.
 */
const PATTERNS: StructuralPattern[] = [
  { matchText: 'SISPAG PAGAMENTO DE FORNECEDOR', kind: 'pending' },
  { matchText: 'SISPAG FORNECEDORES', kind: 'pending' },
  { matchText: 'JUROS', kind: 'expense', category: 'Juros de conta' },
]

/** Balance/limit snapshot lines, not movements — share the exact `DD/MM/YYYY <text> <bare
 * number>` shape a real transaction has (measured 2026-08, design.md D9). `SALDO ANTERIOR`
 * (the opening-balance carry-forward, same label Bradesco uses) found live during the
 * real-data backfill: a statement whose page range starts mid-month carries one, dated to
 * the last day of the PRIOR month, with no date of its own reflected in the amount. */
const BALANCE_LINE_PATTERNS = ['SALDO TOTAL DISPONIVEL', 'SALDO EM CONTA CORRENTE', 'SALDO ANTERIOR']

const LINE_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.*)$/
const BARE_AMOUNT_PATTERN = /(-)?\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/

/**
 * Real transaction lines (measured 2026-08, design.md D9) carry essentially
 * no `R$` marker at all — `findBareMoneyInText` is used instead of
 * `findMoneyInText` throughout. Separately, and independently: a long razão
 * social pushes the CNPJ and the amount onto continuation lines with no
 * date of their own — real examples range from one extra line up to three
 * ("RECEBIMENTO REDE ELO\nCD0107244993\nREDECARD INSTITUICAO DE\nPAGAMENTO
 * S.A. ... 34,83"), so this joins lines one at a time, bounded by whichever
 * comes first: an amount is found, or the next line starts its own date.
 */
export function parseItauStatement(pages: PdfPage[]): ParseStatementLinesResult {
  const rows: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  for (const page of pages) {
    const lines = page.lines

    for (let index = 0; index < lines.length; index += 1) {
      const rowReference = `p${page.pageNumber}L${index + 1}`
      const dateMatch = LINE_DATE_PATTERN.exec(lines[index])
      if (!dateMatch) continue

      const [, day, month, year, firstRest] = dateMatch
      const occurredOn = parseBrDate(day, month, year)
      if (!occurredOn) {
        rejections.push({ rowReference, reason: 'unparseable_date', detail: `"${day}/${month}/${year}" is not a valid date` })
        continue
      }

      const parts = [firstRest]
      let money = findBareMoneyInText(firstRest)
      let ahead = 0
      while (!money && index + 1 + ahead < lines.length && !LINE_DATE_PATTERN.test(lines[index + 1 + ahead])) {
        parts.push(lines[index + 1 + ahead])
        money = findBareMoneyInText(parts.join(' '))
        ahead += 1
      }

      if (!money) {
        rejections.push({
          rowReference,
          reason: 'unparseable_amount',
          detail: `Line has a date but no recognisable amount, including its continuation lines: "${lines[index]}"`,
        })
        continue
      }

      const combined = parts.join(' ')
      const amountMatch = BARE_AMOUNT_PATTERN.exec(combined)
      const description = (amountMatch ? combined.slice(0, amountMatch.index) : combined).trim()
      const normalizedDescription = normalizeForMatch(description)

      if (BALANCE_LINE_PATTERNS.some(pattern => normalizedDescription.includes(pattern))) continue

      const structural = PATTERNS.find(pattern => normalizedDescription.includes(normalizeForMatch(pattern.matchText)))

      rows.push({
        occurredOn,
        amountCents: money.amountCents,
        direction: money.negative ? 'outflow' : 'inflow',
        counterpartyRaw: description,
        sourceRef: rowReference,
        ...(structural ? { structuralHint: { kind: structural.kind, category: structural.category } } : {}),
      })
    }
  }

  return { rows, rejections }
}
