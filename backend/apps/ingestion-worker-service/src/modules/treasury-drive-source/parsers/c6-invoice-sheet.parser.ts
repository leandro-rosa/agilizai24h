import type { TreasuryRawRejection, TreasuryRawRow } from '@app/treasury-ingestion-contracts'
import { C6_INVOICE_PATTERNS } from '../../treasury-ingestion/parsers/c6-invoice.parser'
import type { ParseStatementLinesResult } from '../../treasury-ingestion/parsers/statement-line'
import { normalizeForMatch } from '../../treasury-ingestion/utils/normalize'

/**
 * C6 invoice Google Sheet ("Fatura C6"), the Drive-sourced counterpart to the PDF
 * `c6-invoice.parser.ts` — same bank, same real transactions, a different export format.
 * Real header: `Data de Compra, Nome no Cartão, Final do Cartão, Categoria, Descrição, Parcela,
 * Valor (em US$), Cotação (em R$), Valor (em R$), Tipo, detalhe`.
 *
 * Structural-hint research (task 7): `Categoria` looks like the sheet's own answer to "does the
 * file already know the classification" — but real sample values ("Empresa para empresa",
 * "Serviços de telecomunicações", "Entretenimento", "-") are merchant-category labels the card
 * network assigns, unrelated to the PDF parser's structural facts. The REAL bank-printed signal
 * lives in `Descrição` instead: a credit/payment line's `Descrição` reads literally "Inclusao de
 * Pagamento" (confirmed real value, same fixture as the "negative Valor" test below) — the exact
 * text `c6-invoice.parser.ts` already recognizes as `kind: 'movement', category: 'Pagamento de
 * fatura'` (and the canonical example in `treasury-ingestion-contracts`'s own doc comment for
 * `structuralHint`). `C6_INVOICE_PATTERNS` is imported from that PDF parser rather than
 * re-typed, so the two export formats of the same bank can never silently drift on what counts
 * as a pagamento/refinanciamento. `Tipo`/`detalhe` are the operator's own classification
 * (lowercase, e.g. "Operacional"/"camera") and are deliberately never read here.
 */
const HEADERS_INDEX = ['Data de Compra', 'Nome no Cartão', 'Final do Cartão', 'Categoria', 'Descrição', 'Parcela', 'Valor (em US$)', 'Cotação (em R$)', 'Valor (em R$)', 'Tipo', 'detalhe']

function toColumnIndex(header: unknown[]): Record<string, number> {
  const index: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = String(cell ?? '').trim()
    if (key) index[key] = i
  })
  return index
}

function toDateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return null
}

/** A hyperlinked cell (ExcelJS reads it as {text, hyperlink}) reads as its visible text; a plain string passes through. */
function toText(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '').trim()
  return String(value ?? '').trim()
}

export function parseC6InvoiceSheet(rows: unknown[][]): ParseStatementLinesResult {
  const [header, ...dataRows] = rows
  const columnIndex = toColumnIndex(header ?? HEADERS_INDEX)
  const result: TreasuryRawRow[] = []
  const rejections: TreasuryRawRejection[] = []

  dataRows.forEach((row, i) => {
    const rowReference = `row${i + 2}`
    const occurredOn = toDateOnly(row[columnIndex['Data de Compra']])
    if (!occurredOn) {
      rejections.push({ rowReference, reason: 'unparseable_date', detail: `"Data de Compra" is not a recognisable date: ${JSON.stringify(row[columnIndex['Data de Compra']])}` })
      return
    }

    const valor = Number(row[columnIndex['Valor (em R$)']])
    if (!Number.isFinite(valor)) {
      rejections.push({ rowReference, reason: 'unparseable_amount', detail: `"Valor (em R$)" is not a number: ${JSON.stringify(row[columnIndex['Valor (em R$)']])}` })
      return
    }

    const descricao = toText(row[columnIndex['Descrição']])
    const normalizedDescricao = normalizeForMatch(descricao)
    const structural = C6_INVOICE_PATTERNS.find(pattern => normalizedDescricao.includes(normalizeForMatch(pattern.matchText)))

    result.push({
      occurredOn,
      amountCents: Math.round(Math.abs(valor) * 100),
      // A negative Valor on an invoice is a credit/payment line (e.g. "Inclusao de Pagamento") — money reducing the balance owed, i.e. an inflow from the invoice's own perspective.
      direction: valor < 0 ? 'inflow' : 'outflow',
      counterpartyRaw: descricao,
      sourceRef: rowReference,
      ...(structural ? { structuralHint: { kind: structural.kind, category: structural.category } } : {}),
    })
  })

  return { rows: result, rejections }
}
