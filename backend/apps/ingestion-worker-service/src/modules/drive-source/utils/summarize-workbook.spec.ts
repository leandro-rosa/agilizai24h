import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'
import { summarizeWorkbook } from './summarize-workbook'

/** The 26 columns of the network-wide sales export, in the real order. */
const SALES_HEADER = [
  'Data/Hora', 'Cliente', 'Local', 'Resultado', 'Quantidade', 'CMV', 'Valor Original', 'Desconto', 'Valor Pago',
  'Margem', 'Margem(%)', 'Líquido', 'Método', 'Adquirente', 'Final cartão', 'Bandeira', 'Cód. interno',
  'Cód. adquirente', 'Ponto de venda', 'Seleção', 'Cód. produto', 'Descrição Produto', 'Categoria produto',
  'Modelo máq.', 'Número comprador', 'Cupom',
]

/** A sales row; everything the summary must NEVER keep (card digits, buyer number, coupon) is filled in on purpose. */
const saleRow = (client: string | null, date: Date | string | null, result = 'OK') => [
  date, client, 'Rua X', result, 1, 3.5, 9, 0, 9, 5.5, 61, 8.6, 'Crédito', 'Cielo', '4242', 'Visa', 'u-1', 'a-1',
  'PDV-9', 'A1', '1071', 'Coca-Cola Zero', 'Bebidas', 'M1', 'BUYER-777', 'CUPOM-123',
]

const at = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h, 0, 0))
const salesSheet = (rows: unknown[][], sheetName = 'Relatório de vendas'): SheetRows => ({ sheetName, rows: [SALES_HEADER, ...rows] })

const OP_LABELS = ['ID PDV', 'Cliente', 'Local', 'Local específico', 'Estoque', 'Tipo de operação', 'Iniciado em', 'Finalizado em']
const PRODUCT_HEADER = [
  'ID produto', 'Código Produto', 'Nome produto', 'Categoria do produto', 'Capacidade', 'Qtd. Anterior', 'Qtd. confirmada',
  'A abastecer', 'Qtd. abastecida', 'Remoções', 'Diferença', 'Qtd. final', 'Valor de custo total', 'Valor de venda total', 'Detalhes das Remoções',
]
const supplySheet = (name: string, client: string, finished: Date | null): SheetRows => ({
  sheetName: name,
  rows: [OP_LABELS, [1, client, 'Cidade', '', '', 'Abastecimento', null, finished], [], PRODUCT_HEADER, [1, '6098', 'Produto', 'Bebidas', 0, 0, '', 6, 6, 0, 0, 6, 0, 0, '']],
})

const bit = (day: number) => 1 << (day - 1)

describe('summarizeWorkbook', () => {
  describe('a network sales file', () => {
    it('is recognised by its structure and reduced to counts, dates and day masks per store and month', () => {
      const summary = summarizeWorkbook([
        salesSheet([
          saleRow('Ascenty - ADM', at(2026, 8, 3)),
          saleRow('Ascenty - ADM', at(2026, 8, 3)),
          saleRow('Ascenty - ADM', at(2026, 8, 31, 23)),
          saleRow('Plena Saude - Taipas', at(2026, 8, 10)),
          saleRow('Plena Saude - Taipas', at(2026, 9, 1)),
        ]),
      ])

      expect(summary.format).toBe('network_sales')
      expect(summary.rowCount).toBe(5)
      expect(summary.monthHistogram).toEqual({ '2026-08': 4, '2026-09': 1 })
      expect(summary.undatedRows).toBe(0)
      expect(summary.storeDays['2026-08']).toEqual({
        'Ascenty - ADM': { rows: 3, dayMask: bit(3) | bit(31) },
        'Plena Saude - Taipas': { rows: 1, dayMask: bit(10) },
      })
      expect(summary.storeDays['2026-09']).toEqual({ 'Plena Saude - Taipas': { rows: 1, dayMask: bit(1) } })
    })

    it('reads the date as the wall-clock value stored in the file: a sale at 23:58 on the 31st stays on the 31st', () => {
      const summary = summarizeWorkbook([salesSheet([saleRow('Ascenty - ADM', new Date('2026-08-31T23:58:47.000Z'))])])

      expect(summary.storeDays['2026-08']['Ascenty - ADM'].dayMask).toBe(bit(31))
      expect(summary.monthHistogram).toEqual({ '2026-08': 1 })
    })

    it('reads a date that arrives as a plain Excel serial number, the other shape the real export produces', () => {
      // 46235.5 = 2026-08-01 12:00 in Excel's 1899-12-30 epoch.
      const summary = summarizeWorkbook([salesSheet([saleRow('Ascenty - ADM', 46235.5 as unknown as Date)])])

      expect(summary.monthHistogram).toEqual({ '2026-08': 1 })
      expect(summary.storeDays['2026-08']['Ascenty - ADM'].dayMask).toBe(bit(1))
    })

    it('counts a declined transaction too: a day with only failed attempts is still a day the store operated', () => {
      const summary = summarizeWorkbook([salesSheet([saleRow('Ascenty - ADM', at(2026, 8, 5), 'Recusada')])])

      expect(summary.storeDays['2026-08']['Ascenty - ADM']).toEqual({ rows: 1, dayMask: bit(5) })
    })

    it('folds whitespace in store names, since the real export has a trailing space in one of them', () => {
      const summary = summarizeWorkbook([
        salesSheet([saleRow('Plena Saude - Mogi ', at(2026, 8, 3)), saleRow('Plena  Saude - Mogi', at(2026, 8, 4))]),
      ])

      expect(Object.keys(summary.storeDays['2026-08'])).toEqual(['Plena Saude - Mogi'])
      expect(summary.storeDays['2026-08']['Plena Saude - Mogi'].rows).toBe(2)
    })

    it('counts rows with no readable date as undated, and does not invent a month for them', () => {
      const summary = summarizeWorkbook([
        salesSheet([saleRow('Ascenty - ADM', at(2026, 8, 3)), saleRow('Ascenty - ADM', '31/08/2026 10:00'), saleRow('Ascenty - ADM', null)]),
      ])

      expect(summary.rowCount).toBe(3)
      expect(summary.undatedRows).toBe(2)
      expect(summary.monthHistogram).toEqual({ '2026-08': 1 })
    })

    it('keeps a dated row that names no store in the month histogram but out of every store', () => {
      const summary = summarizeWorkbook([salesSheet([saleRow(null, at(2026, 8, 3)), saleRow('Ascenty - ADM', at(2026, 8, 3))])])

      expect(summary.monthHistogram).toEqual({ '2026-08': 2 })
      expect(Object.keys(summary.storeDays['2026-08'])).toEqual(['Ascenty - ADM'])
    })

    it('ignores empty rows and finds the header even when it is not on the first row', () => {
      const sheet: SheetRows = { sheetName: 'r', rows: [[], ['Relatório'], SALES_HEADER, [null, null], saleRow('Ascenty - ADM', at(2026, 8, 3))] }

      const summary = summarizeWorkbook([sheet])

      expect(summary.format).toBe('network_sales')
      expect(summary.rowCount).toBe(1)
    })

    it('is a network sales file only if it carries every column the worker cannot read it without', () => {
      const withoutResult = ['Data/Hora', 'Cliente', 'Descrição Produto', 'Quantidade']

      expect(summarizeWorkbook([{ sheetName: 'r', rows: [withoutResult, [at(2026, 8, 3), 'Ascenty - ADM', 'x', 1]] }]).format).toBe('unknown')
    })

    it('keeps aggregates only: no coupon, buyer number, card digits or product ever appears in the summary', () => {
      const summary = summarizeWorkbook([salesSheet([saleRow('Ascenty - ADM', at(2026, 8, 3)), saleRow('Ascenty - ADM', at(2026, 8, 4))])])
      const serialized = JSON.stringify(summary)

      for (const secret of ['BUYER-777', 'CUPOM-123', '4242', 'Coca-Cola Zero', 'PDV-9', 'Visa', 'Cielo']) {
        expect(serialized).not.toContain(secret)
      }
    })
  })

  describe('a restocking workbook', () => {
    it('is recognised by its operation sheets and reduced to the months in which operations finished', () => {
      const summary = summarizeWorkbook([
        supplySheet('Operação 1', 'Ascenty - JDI01', at(2026, 7, 2)),
        supplySheet('Operação 2', 'Ascenty - ADM', at(2026, 7, 20)),
        supplySheet('Operação 3', 'Plena Saude - Taipas', at(2026, 8, 1)),
      ])

      expect(summary.format).toBe('supply')
      expect(summary.rowCount).toBe(3)
      expect(summary.monthHistogram).toEqual({ '2026-07': 2, '2026-08': 1 })
      expect(summary.storeDays).toEqual({})
    })

    it('counts an operation with no finish date as undated', () => {
      const summary = summarizeWorkbook([supplySheet('Operação 1', 'Ascenty - JDI01', null), supplySheet('Operação 2', 'Ascenty - ADM', at(2026, 7, 2))])

      expect(summary.undatedRows).toBe(1)
      expect(summary.monthHistogram).toEqual({ '2026-07': 1 })
    })

    it('is not mistaken for sales although its sheets also carry a "Cliente" column', () => {
      expect(summarizeWorkbook([supplySheet('Operação 1', 'Ascenty - JDI01', at(2026, 7, 2))]).format).toBe('supply')
    })
  })

  describe('everything else', () => {
    it('recognises the old per-store sales report, which has no store in the file', () => {
      const legacy: SheetRows = {
        sheetName: 'Relatório',
        rows: [
          ['ID', 'Código', 'Descrição', 'Categoria', 'Preço de referência', 'Preço médio', 'Qtd. vendida', 'Valor Vendido'],
          [320, '1071', 'Refrigerante Coca-Cola Zero', 'Bebidas', 6.9, 7.9, 120, 948],
          [319, '1070', 'Refrigerante Coca-Cola', 'Bebidas', 6.9, 7.9, 107, 845.3],
        ],
      }

      const summary = summarizeWorkbook([legacy])

      expect(summary.format).toBe('legacy_store_sales')
      expect(summary.rowCount).toBe(2)
      expect(summary.monthHistogram).toEqual({})
      expect(summary.undatedRows).toBe(2)
    })

    it('reports a workbook it does not understand as unknown', () => {
      expect(summarizeWorkbook([{ sheetName: 'x', rows: [['a', 'b'], [1, 2]] }]).format).toBe('unknown')
      expect(summarizeWorkbook([]).format).toBe('unknown')
    })
  })
})
