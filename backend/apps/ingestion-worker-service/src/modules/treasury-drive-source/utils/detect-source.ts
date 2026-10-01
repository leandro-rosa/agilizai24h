import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'
import type { TreasurySource } from '@app/treasury-ingestion-contracts'

const SEARCH_WINDOW = 15

function cellText(cell: unknown): string {
  if (cell && typeof cell === 'object' && 'richText' in cell) {
    return (cell as { richText: { text: string }[] }).richText.map(part => part.text).join('')
  }
  if (cell && typeof cell === 'object' && 'text' in cell) return String((cell as { text: unknown }).text ?? '')
  return String(cell ?? '')
}

function rowHasAll(row: unknown[], labels: string[]): boolean {
  const cells = row.map(cell => cellText(cell).trim())
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

function matchesPagBankStatement(rows: unknown[][]): boolean {
  return rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['PagSeguro Internet S/A']))
    && rows.slice(0, SEARCH_WINDOW).some(row => rowHasAll(row, ['Entradas', 'Saidas']))
}

export function detectTreasurySheetSource(sheets: SheetRows[], bankFolderName: string): TreasurySource | null {
  const bank = bankFolderName.trim().toLowerCase()

  for (const sheet of sheets) {
    if (bank === 'itau' && matchesItauStatement(sheet.rows)) return 'itau_statement'
    if (bank === 'c6' && matchesC6Invoice(sheet.rows)) return 'c6_invoice'
    if (bank === 'c6' && matchesC6Statement(sheet.rows)) return 'c6_statement'
    if (bank === 'pagseguro' && matchesPagBankStatement(sheet.rows)) return 'pagbank_statement'
  }

  return null
}
