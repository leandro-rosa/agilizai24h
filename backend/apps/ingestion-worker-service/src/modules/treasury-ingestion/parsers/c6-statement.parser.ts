import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import type { PdfPage } from '../utils/pdf-text'
import { parseBrDate } from '../utils/date'
import { findMoneyInText } from '../utils/money'
import { normalizeForMatch } from '../utils/normalize'
import { stripKnownPrefix, type ParseStatementLinesResult, type StructuralPattern } from './statement-line'

/**
 * C6 extrato — real shape (measured 2026-08, see design.md D9), tab-separated:
 * `DD/MM<lançamento>\tDD/MM<contábil>\t<Tipo>\t<Descrição>\t<Valor>`. Neither
 * date carries a year — it only appears once per month, in a
 * "Mês AAAA ( DD/MM/AAAA - DD/MM/AAAA )" section header — so this doesn't
 * reuse `parseStatementLines` (single-line, DD/MM/AAAA-anchored) at all,
 * unlike every other parser here; it tracks "current year" as state updated
 * by that header, carried across the whole document (a month's lines can
 * span a page break).
 */
const SECTION_YEAR_PATTERN = /\(\s*\d{2}\/\d{2}\/(\d{4})\s*-/
const TRANSACTION_LINE_PATTERN = /^(\d{2})\/(\d{2})\s*\t\d{2}\/\d{2}\s*\t([^\t]*)\t([^\t]*)\t(.*)$/

/**
 * PGTO FAT CARTAO C6, CDB e financeiro/tributos são estruturalmente fixos
 * (o próprio Tipo da coluna já responde a classificação) independente do
 * favorecido — confirmados literalmente no texto real (Anexo A §3).
 */
const PATTERNS: StructuralPattern[] = [
  { matchText: 'PGTO FAT CARTAO C6', kind: 'movement', category: 'Pagamento de fatura' },
  { matchText: 'CDB C6 LIM.GARANT', kind: 'movement', category: 'CDB' },
  { matchText: 'EMISSAO DE CDB', kind: 'movement', category: 'CDB' },
  { matchText: 'RESGATE DE CDB', kind: 'movement', category: 'CDB' },
  { matchText: 'SEGURO CONTA C6', kind: 'expense', category: 'Financeiro/Tributos' },
  { matchText: 'JUROS CHEQUE ESP', kind: 'expense', category: 'Financeiro/Tributos' },
  { matchText: 'IOF CHEQUE ESPECIAL', kind: 'expense', category: 'Financeiro/Tributos' },
  { matchText: 'SIMPLES NACIONAL', kind: 'expense', category: 'Financeiro/Tributos' },
  { matchText: 'RECEITA FEDERAL', kind: 'expense', category: 'Financeiro/Tributos' },
]

/**
 * Only "Entrada PIX"/"Saída PIX"/"Devolução PIX" glue a verb phrase onto the
 * Descrição text itself — every other Tipo ("Outros gastos", "Pagamento",
 * "Entradas", "Débito de Cartão") carries its bare label/merchant name
 * directly, nothing to strip. Confirmed against the real file; the Tipo
 * column value itself is never part of the description text, so it is
 * never a candidate verb prefix (unlike the earlier, unmeasured guess).
 */
const VERB_PREFIXES = ['Pix enviado para', 'Pix recebido de', 'Devol recebida pix de']

export function parseC6Statement(pages: PdfPage[]): ParseStatementLinesResult {
  const rows: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []
  let currentYear: string | null = null

  for (const page of pages) {
    page.lines.forEach((line, lineIndex) => {
      const rowReference = `p${page.pageNumber}L${lineIndex + 1}`

      const yearMatch = SECTION_YEAR_PATTERN.exec(line)
      if (yearMatch) {
        currentYear = yearMatch[1]
        return
      }

      const match = TRANSACTION_LINE_PATTERN.exec(line)
      // Not every line is a transaction — page headers, "Saldo do dia
      // DD/MM/AA", and boilerplate never match two tab-separated DD/MM
      // dates followed by three more tab-separated fields.
      if (!match) return

      const [, day, month, , descriptionRaw, valorText] = match

      if (!currentYear) {
        rejections.push({
          rowReference,
          reason: 'missing_year',
          detail: `No "Mês AAAA ( DD/MM/AAAA - ... )" section header seen before this line: "${line}"`,
        })
        return
      }

      const occurredOn = parseBrDate(day, month, currentYear)
      if (!occurredOn) {
        rejections.push({ rowReference, reason: 'unparseable_date', detail: `"${day}/${month}/${currentYear}" is not a valid date` })
        return
      }

      const money = findMoneyInText(valorText)
      if (!money) {
        rejections.push({
          rowReference,
          reason: 'unparseable_amount',
          detail: `Line has a date but no recognisable R$ amount: "${line}"`,
        })
        return
      }

      const description = descriptionRaw.trim()
      const normalizedDescription = normalizeForMatch(description)
      const structural = PATTERNS.find(pattern => normalizedDescription.includes(normalizeForMatch(pattern.matchText)))

      rows.push({
        occurredOn,
        amountCents: money.amountCents,
        direction: money.negative ? 'outflow' : 'inflow',
        counterpartyRaw: stripKnownPrefix(description, VERB_PREFIXES),
        sourceRef: rowReference,
        ...(structural ? { structuralHint: { kind: structural.kind, category: structural.category } } : {}),
      })
    })
  }

  return { rows, rejections }
}
