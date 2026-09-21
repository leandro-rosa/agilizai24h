import * as XLSX from 'xlsx'
import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'

/**
 * Spreadsheet builders for tests. Everything they produce is SYNTHETIC and lives only
 * in memory or in a test's temporary directory: it is never written to a database and
 * never uploaded anywhere. Store names are prefixed so a fixture can never be mistaken
 * for a real store in a screenshot or a log.
 */

/** The 26 columns of the network-wide sales export, in the real order. */
export const SALES_HEADER = [
  'Data/Hora', 'Cliente', 'Local', 'Resultado', 'Quantidade', 'CMV', 'Valor Original', 'Desconto', 'Valor Pago',
  'Margem', 'Margem(%)', 'Líquido', 'Método', 'Adquirente', 'Final cartão', 'Bandeira', 'Cód. interno',
  'Cód. adquirente', 'Ponto de venda', 'Seleção', 'Cód. produto', 'Descrição Produto', 'Categoria produto',
  'Modelo máq.', 'Número comprador', 'Cupom',
]

/** A sale row whose sensitive cells (buyer number, card digits, coupon) are filled in on purpose, to prove they never leave the file. */
export const saleRow = (client: string | null, date: Date | string | null, result = 'OK'): unknown[] => [
  date, client, 'Rua X', result, 1, 3.5, 9, 0, 9, 5.5, 61, 8.6, 'Crédito', 'Cielo', '4242', 'Visa', 'u-1', 'a-1',
  'PDV-9', 'A1', '1071', 'Coca-Cola Zero', 'Bebidas', 'M1', 'BUYER-777', 'CUPOM-123',
]

export const at = (year: number, month: number, day: number, hour = 12): Date => new Date(Date.UTC(year, month - 1, day, hour, 0, 0))

/** Two sales per listed day for each store, at 10:00 and 15:00 store-local (stored as UTC, like the real export). */
export function salesSheetFor(period: string, storeDays: Record<string, number[]>): SheetRows {
  const [year, month] = period.split('-').map(Number)
  const rows: unknown[][] = []

  for (const [store, days] of Object.entries(storeDays)) {
    for (const day of days) {
      rows.push(saleRow(store, at(year, month, day, 10)), saleRow(store, at(year, month, day, 15)))
    }
  }

  return { sheetName: 'Relatório de vendas', rows: [SALES_HEADER, ...rows] }
}

const OP_LABELS = ['ID PDV', 'Cliente', 'Local', 'Local específico', 'Estoque', 'Tipo de operação', 'Iniciado em', 'Finalizado em']
const PRODUCT_HEADER = [
  'ID produto', 'Código Produto', 'Nome produto', 'Categoria do produto', 'Capacidade', 'Qtd. Anterior', 'Qtd. confirmada',
  'A abastecer', 'Qtd. abastecida', 'Remoções', 'Diferença', 'Qtd. final', 'Valor de custo total', 'Valor de venda total', 'Detalhes das Remoções',
]

/** One operation sheet of a restocking workbook. */
export const supplySheet = (name: string, client: string, finished: Date | null): SheetRows => ({
  sheetName: name,
  rows: [
    OP_LABELS,
    [1, client, 'Cidade', '', '', 'Abastecimento', null, finished],
    [],
    PRODUCT_HEADER,
    [1, '6098', 'Produto', 'Bebidas', 0, 0, '', 6, 6, 0, 0, 6, 0, 0, ''],
  ],
})

/** The old per-store sales report: no store in the file, no dates. */
export const legacyStoreSalesSheet = (): SheetRows => ({
  sheetName: 'Relatório',
  rows: [
    ['ID', 'Código', 'Descrição', 'Categoria', 'Preço de referência', 'Preço médio', 'Qtd. vendida', 'Valor Vendido'],
    [320, '1071', 'Refrigerante Coca-Cola Zero', 'Bebidas', 6.9, 7.9, 120, 948],
  ],
})

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

/**
 * Serialises sheets into a real .xlsx, so the whole reading path (ExcelJS, then SheetJS) is exercised.
 *
 * Dates are written the way the real POS export writes them: a serial NUMBER with a
 * date number format. Letting SheetJS write a JS Date instead produces a `t="d"` cell
 * holding ISO text, which ExcelJS reads back as the number 2026 — a fixture artefact
 * that would have made every date in a test land in 1905.
 */
export function xlsxBuffer(sheets: SheetRows[]): Buffer {
  const workbook = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const serialised = sheet.rows.map(row => row.map(cell => (cell instanceof Date ? (cell.getTime() - EXCEL_EPOCH_MS) / MS_PER_DAY : cell)))
    const worksheet = XLSX.utils.aoa_to_sheet(serialised)

    sheet.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell instanceof Date) worksheet[XLSX.utils.encode_cell({ r, c })].z = 'yyyy-mm-dd hh:mm:ss'
      }),
    )

    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName)
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Every day of a month on the given weekdays (0 = Sunday), minus the excluded ones. */
export function daysOn(period: string, weekdays: number[], excluded: number[] = []): number[] {
  const [year, month] = period.split('-').map(Number)
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return Array.from({ length: total }, (_, i) => i + 1).filter(
    day => weekdays.includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay()) && !excluded.includes(day),
  )
}

export const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)
