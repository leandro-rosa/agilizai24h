import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import { parseBrDate } from '../utils/date'
import { findMoneyInText } from '../utils/money'
import { normalizeForMatch } from '../utils/normalize'

/**
 * Assumed shape for every PDF statement line, absent real bank exports to
 * measure against (known gap — see CLAUDE.md): a date at the start, the
 * description/favorecido in the middle, the signed amount somewhere after
 * it. Each bank's parser only supplies its own structural patterns; this is
 * the one place the line shape itself is assumed, so a real export proving
 * it wrong changes one function, not five.
 */
const LINE_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.*)$/

/**
 * A structural pattern: when a line's description contains `matchText`, the
 * file's OWN format already answers the classification question — never a
 * favorecido to resolve via mapping rules (design:
 * add-treasury-statement-ingestion, task 3.6, and the fatura/CDB/empréstimo
 * patterns in add-treasury-classification-model's seed).
 */
export interface StructuralPattern {
  matchText: string
  kind: 'movement' | 'expense' | 'pending'
  category?: string
}

export interface ParseStatementLinesResult {
  rows: TreasuryRawRow[]
  rejections: TreasuryRawRejection[]
}

/**
 * Statement lines don't lead with the favorecido — they lead with the
 * bank's own label for the transaction type ("Pix enviado", "Entrada PIX",
 * ...), which is exactly the kind of format detail `add-treasury-statement-
 * ingestion`'s design assigns to the parser, not the consumer. Left
 * unstripped, `counterpartyRaw` never equals a mapping rule's `match_text`
 * (add-treasury-classification-model's seed stores bare names, e.g.
 * "AMBEV", not "Pix enviado AMBEV") — every `exact` rule would silently
 * never fire. Matched by leading token count against `normalizeForMatch`
 * output (not a char-index slice of the normalized string), so accents and
 * punctuation differences between the pattern literal and the extracted
 * text don't matter — same reasoning as `normalizeForMatch` itself. Longest
 * prefix wins, mirroring `longestContainsMatch` in treasury-service.
 */
export function stripKnownPrefix(description: string, verbPrefixes: string[]): string {
  const tokens = description.trim().split(/\s+/)
  const normalizedTokens = normalizeForMatch(description).split(' ')

  const sortedPrefixes = [...verbPrefixes].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)

  for (const prefix of sortedPrefixes) {
    const prefixTokens = normalizeForMatch(prefix).split(' ')
    const matches = prefixTokens.every((token, index) => normalizedTokens[index] === token)
    if (matches) {
      let remainder = tokens.slice(prefixTokens.length)
      // A raw token that is PURE punctuation (a lone "-", ":", ...) normalizes away to nothing
      // and never shows up in `normalizedTokens` at all — the prefix match above still succeeds
      // (it only compares the matched tokens themselves), but slicing the RAW array by the
      // NORMALIZED prefix's token COUNT leaves that punctuation token sitting right after the
      // slice point. Real text measured against a real PagBank statement: "Pix enviado - F&r
      // Solucoes Experience" — without this, counterpartyRaw comes out "- F&r Solucoes
      // Experience", a stray dash glued onto the favorecido.
      while (remainder.length > 0 && normalizeForMatch(remainder[0]) === '') {
        remainder = remainder.slice(1)
      }
      return remainder.join(' ').trim()
    }
  }

  return description
}

/**
 * Parses one page's lines into raw rows, applying the source's own
 * structural patterns (case-insensitive substring match against the
 * description) before falling back to an ordinary line with no hint —
 * `treasury-service` resolves those against `CounterpartyMapping` on
 * arrival. `verbPrefixes` (also source-supplied) strips the bank's own
 * transaction-type label from the front of `counterpartyRaw` first — see
 * `stripKnownPrefix`.
 */
export function parseStatementLines(
  pageNumber: number,
  lines: string[],
  structuralPatterns: StructuralPattern[],
  verbPrefixes: string[] = [],
): ParseStatementLinesResult {
  const rows: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  lines.forEach((line, lineIndex) => {
    const rowReference = `p${pageNumber}L${lineIndex + 1}`
    const dateMatch = LINE_DATE_PATTERN.exec(line)
    if (!dateMatch) {
      // Not every line is a transaction — page headers/footers and column
      // titles never match a leading date, and are silently not rows rather
      // than rejections: a rejection is for a line that LOOKED like a
      // transaction but could not be fully read.
      return
    }

    const [, day, month, year, firstRest] = dateMatch
    const occurredOn = parseBrDate(day, month, year)
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"${day}/${month}/${year}" is not a valid date` })
      return
    }

    // A description can spill onto the next physical line(s) with no date
    // of its own before the amount appears — measured against a real
    // PagBank statement: "Pagamento com QR Code - Para: PAGSEGURO INTERNET
    // INSTITUICAO DE" / "PAGAMENTO -R$ 24,90" (the recurring "Cobrança
    // PagBank Saúde"/"Cobrança Seguro Cartão Protegido"/"Mensalidade Seguro
    // Conta" self-fees — previously silently rejected every month, 24
    // rejections across jan-ago/2026 real data, R$317,60 never imported).
    // Joins lines one at a time, bounded by whichever comes first: an
    // amount is found, or the next line starts its own date — same pattern
    // the Itaú parser already uses for its multi-line continuations.
    const parts = [firstRest]
    let money = findMoneyInText(firstRest)
    let ahead = 0
    while (!money && lineIndex + 1 + ahead < lines.length && !LINE_DATE_PATTERN.test(lines[lineIndex + 1 + ahead])) {
      parts.push(lines[lineIndex + 1 + ahead])
      money = findMoneyInText(parts.join(' '))
      ahead += 1
    }

    if (!money) {
      rejections.push({
        rowReference,
        reason: 'unparseable_amount',
        detail: `Line has a date but no recognisable R$ amount, including its continuation lines: "${line}"`,
      })
      return
    }

    const rest = parts.join(' ')
    const description = rest.replace(/-?\s*R\$\s*[\d.,]+/, '').trim()
    const normalizedDescription = normalizeForMatch(description)
    const structural = structuralPatterns.find(pattern =>
      normalizedDescription.includes(normalizeForMatch(pattern.matchText)),
    )

    rows.push({
      occurredOn,
      amountCents: money.amountCents,
      direction: money.negative ? 'outflow' : 'inflow',
      counterpartyRaw: stripKnownPrefix(description, verbPrefixes),
      sourceRef: rowReference,
      ...(structural ? { structuralHint: { kind: structural.kind, category: structural.category } } : {}),
    })
  })

  return { rows, rejections }
}
