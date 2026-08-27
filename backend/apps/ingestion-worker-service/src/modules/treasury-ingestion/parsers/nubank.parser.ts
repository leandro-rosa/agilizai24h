import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { PdfPage } from '../utils/pdf-text'
import { monthFromPtAbbreviation, parseBrDate } from '../utils/date'
import { parseBrlAmountToCents } from '../utils/money'

/**
 * Nubank extrato — no `R$` on any real transaction line, no per-transaction
 * date (only on a day-header), and a real record spans 3-5 physical lines
 * (measured 2026-08, design.md D9) — the most divergent of the six sources,
 * built as a dedicated block-assembler local to this parser rather than the
 * shared single-line `parseStatementLines` (see design.md D10 for why this
 * isn't shared with Itaú's simpler lookahead join).
 *
 * State machine over one FLATTENED sequence of lines across every page (a
 * day's block can span a `pdf-parse` page boundary — measured directly):
 * `currentDay` updates on a day-header line; `currentDirection` updates on
 * EITHER a day-header OR a bare direction sub-header (a day can have more
 * than one — entradas first, then a later "Total de saídas -Y" switches
 * direction for the rest of that same day, with no day marker repeated).
 * Every other non-noise line accumulates into the open block; a block
 * CLOSES on any line ending in a bare amount (not just a line that IS
 * only an amount — see the page-boundary note below).
 */
const DAY_HEADER_PATTERN = /^(\d{2})\s+([A-ZÀ-Ú]{3})\s+(\d{4})\s+Total de (entradas|sa[íi]das)\s*[+-]\s*[\d.,]+\s*$/i
const DIRECTION_HEADER_PATTERN = /^Total de (entradas|sa[íi]das)\s*[+-]\s*[\d.,]+\s*$/i
const SALDO_LINE_PATTERN = /^Saldo do dia\b/i
const CLOSING_LINE_PATTERN = /^(.*?)\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})\s*$/

/**
 * Fixed boilerplate repeated on every page (header) or that only appears
 * once (page-1 summary box, gated out entirely by the "Movimentações"
 * start marker below, not by this list) — never transaction content.
 */
const NOISE_PATTERNS: RegExp[] = [
  /^AGILIZ\.AI LTDA$/,
  /CNPJ Ag[êe]ncia Conta/,
  /VALORES EM R\$/,
  /^\d{9}-\d$/,
  /Tem alguma d[úu]vida/,
  // The footer's 3 paragraphs each wrap across 2 physical lines — matching
  // only each paragraph's first line left the wrapped continuation
  // (measured: "metropolitanas) ou 0800 591 2117...", "disponíveis em
  // nubank.com.br/...") falling through as unrecognised text, dangling an
  // otherwise-closed block into a spurious rejection.
  /^metropolitanas\)/,
  /Caso a solu[çc][ãa]o fornecida/,
  /dispon[íi]veis em nubank\.com\.br/,
  /Extrato gerado dia/,
  /^\d{1,2} de \d+\s*$/, // "N de 22" page-footer marker, occasionally glued onto the next line's start
]

export function parseNubankStatement(pages: PdfPage[]): { rows: TreasuryRawRow[]; rejections: TreasuryRawRejection[] } {
  const rows: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  const flatLines = pages.flatMap(page => page.lines.map((text, lineIndex) => ({ page: page.pageNumber, ref: `p${page.pageNumber}L${lineIndex + 1}`, text: text.trim() })))

  let currentDay: string | null = null
  let currentDirection: 'inflow' | 'outflow' | null = null
  let started = false
  let block: { text: string; ref: string }[] = []

  const rejectDangling = (reason: string) => {
    if (block.length === 0) return
    rejections.push({
      rowReference: block[0].ref,
      reason: 'unparseable_amount',
      detail: `${reason}: "${block.map(part => part.text).join(' ')}"`,
    })
    block = []
  }

  for (const line of flatLines) {
    if (!started) {
      if (line.text === 'Movimentações') started = true
      continue
    }

    if (line.text === '') continue
    if (NOISE_PATTERNS.some(pattern => pattern.test(line.text))) continue

    const dayMatch = DAY_HEADER_PATTERN.exec(line.text)
    if (dayMatch) {
      rejectDangling('No amount found before the next day header')
      const [, day, monthAbbreviation, year, direction] = dayMatch
      const month = monthFromPtAbbreviation(monthAbbreviation)
      currentDay = month ? parseBrDate(day, String(month).padStart(2, '0'), year) : null
      currentDirection = /entradas/i.test(direction) ? 'inflow' : 'outflow'
      continue
    }

    const directionMatch = DIRECTION_HEADER_PATTERN.exec(line.text)
    if (directionMatch) {
      rejectDangling('No amount found before the direction changed')
      currentDirection = /entradas/i.test(directionMatch[1]) ? 'inflow' : 'outflow'
      continue
    }

    if (SALDO_LINE_PATTERN.test(line.text)) {
      rejectDangling('No amount found before the day-balance line')
      continue
    }

    // A block closes on any line ENDING in a bare amount — not only a line
    // that is nothing else, because a real page break in this document
    // duplicates the last visible row's tail onto the following page (a
    // pdf-parse extraction characteristic of this specific PDF, measured
    // directly): "...TELECOMUNICACOES 580,00" appears as one line, followed
    // immediately by a fresh, complete repeat of the same transaction on
    // the next page. Closing on any amount-ending line lets the first
    // (glued) occurrence resolve correctly on its own; the residual risk is
    // an occasional page-boundary row whose counterpartyRaw carries a
    // stray leading fragment from the duplicated tail — never a wrong
    // amount or date, and caught by the mandatory human review before
    // anything counts (see gap note in CLAUDE.md).
    const closingMatch = CLOSING_LINE_PATTERN.exec(line.text)
    if (!closingMatch) {
      block.push(line)
      continue
    }

    const [, leadingText, amountText] = closingMatch
    if (leadingText) block.push({ ...line, text: leadingText })

    if (!currentDay || !currentDirection) {
      rejections.push({
        rowReference: block[0]?.ref ?? line.ref,
        reason: 'missing_context',
        detail: `No day/direction header seen before this line: "${line.text}"`,
      })
      block = []
      continue
    }

    const amountCents = parseBrlAmountToCents(amountText)
    if (amountCents === null || block.length === 0) {
      rejections.push({
        rowReference: block[0]?.ref ?? line.ref,
        reason: 'unparseable_amount',
        detail: `Could not resolve an amount/description for: "${[...block.map(part => part.text), line.text].join(' ')}"`,
      })
      block = []
      continue
    }

    rows.push({
      occurredOn: currentDay,
      amountCents,
      direction: currentDirection,
      counterpartyRaw: block.map(part => part.text).join(' ').trim(),
      sourceRef: block[0].ref,
    })
    block = []
  }

  return { rows, rejections }
}
