import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'
import type { TreasurySource } from '@app/treasury-ingestion-contracts'

const SEARCH_WINDOW = 15

function rowHasAll(row: unknown[], labels: string[]): boolean {
  const cells = row.map(cell => String(cell ?? '').trim())
  return labels.every(label => cells.some(cell => cell.includes(label)))
}

function matchesItauStatement(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Agência:']) || rowHasAll(row, ['Conta:']))
    && rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Período:']) || rowHasAll(row, ['Periodo:']))
}

function matchesC6Statement(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Entrada(R$)', 'Saída(R$)']))
}

function matchesC6Invoice(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Nome no Cartão', 'Valor (em R$)']))
}

export function detectTreasurySheetSource(sheets: SheetRows[], bankFolderName: string): TreasurySource | null {
  const bank = bankFolderName.trim().toLowerCase()

  for (const sheet of sheets) {
    if (bank === 'itau' && matchesItauStatement(sheet.rows)) return 'itau_statement'
    if (bank === 'c6' && matchesC6Invoice(sheet.rows)) return 'c6_invoice'
    if (bank === 'c6' && matchesC6Statement(sheet.rows)) return 'c6_statement'
  }

  return null
}
