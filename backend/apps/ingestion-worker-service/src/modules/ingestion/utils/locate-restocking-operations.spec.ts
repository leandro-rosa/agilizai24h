import { locateRestockingOperations } from './locate-restocking-operations'
import type { SheetRows } from './read-workbook-rows'

const OP_LABELS = [
  'ID PDV',
  'Cliente',
  'Local',
  'Local específico',
  'Estoque',
  'Tipo de operação',
  'Iniciado em',
  'Finalizado em',
]
const opValues = (cliente: string, kind: string) => [1, cliente, 'Cidade', '', '', kind, 0, 0]
const PRODUCT_HEADER = [
  'ID produto',
  'Código Produto',
  'Nome produto',
  'Categoria do produto',
  'Capacidade',
  'Qtd. Anterior',
  'Qtd. confirmada',
  'A abastecer',
  'Qtd. abastecida',
  'Remoções',
  'Diferença',
  'Qtd. final',
  'Valor de custo total',
  'Valor de venda total',
  'Detalhes das Remoções',
]
const productRow = (code: string) => [1, code, 'Produto', 'Bebidas', 0, 0, '', 6, 6, 0, 0, 6, 0, 0, '']

describe('locateRestockingOperations', () => {
  describe('the shape ExcelJS produces (blank row present, matching every real month measured)', () => {
    const sheet = (cliente: string, kind = 'Abastecimento'): SheetRows => ({
      sheetName: 'Operação 1',
      rows: [OP_LABELS, opValues(cliente, kind), [], PRODUCT_HEADER, productRow('6098')],
    })

    it('locates the product header at index 3 (1-indexed row 4)', () => {
      const result = locateRestockingOperations([sheet('Ascenty - JDI01')])

      expect(result.headerRowNumber).toBe(4)
      expect(result.operations[0]).toMatchObject({ clientRaw: 'Ascenty - JDI01', operationKind: 'restocking' })
    })
  })

  describe('the shape @app/sheeter\'s SheetJS fallback produces (blank row DROPPED — blankrows: false)', () => {
    // This is the bug caught during the March 2026 backfill: ExcelJS could
    // not parse a real export at all (reproducible standalone, unrelated to
    // content), so smartChunk fell back to SheetJS, whose blank-row-dropping
    // shifted every row number after the blank one. Every product row was
    // rejected as "missing product" because what smartChunk treated as the
    // header was actually the first product row.
    const sheet = (cliente: string, kind = 'Abastecimento'): SheetRows => ({
      sheetName: 'Operação 1',
      // No blank row here — matches `rowsPerSheetFromSheetJS`'s `blankrows: false`.
      rows: [OP_LABELS, opValues(cliente, kind), PRODUCT_HEADER, productRow('6098')],
    })

    it('locates the product header one row earlier — index 2 (1-indexed row 3)', () => {
      const result = locateRestockingOperations([sheet('Ascenty - JDI01')])

      expect(result.headerRowNumber).toBe(3)
    })

    it('the located row number is the ACTUAL header, not the first product row', () => {
      // The regression, asserted directly: reading the row this function
      // says is the header must yield "Código Produto", never a real SKU.
      const input = [sheet('Ascenty - JDI01')]
      const result = locateRestockingOperations(input)

      const headerRow = input[0].rows[result.headerRowNumber! - 1]
      expect(headerRow).toContain('Código Produto')
      expect(headerRow).not.toContain('6098')
    })
  })

  describe('operation kinds', () => {
    it('recognises Abastecimento, Inventário and Combinado', () => {
      const of = (kind: string): SheetRows => ({
        sheetName: kind,
        rows: [OP_LABELS, opValues('Ascenty - JDI01', kind), [], PRODUCT_HEADER, productRow('6098')],
      })

      const result = locateRestockingOperations([of('Abastecimento'), of('Inventário'), of('Combinado')])

      expect(result.operations.map(o => o.operationKind)).toEqual(['restocking', 'inventory', 'combined'])
    })

    it('rejects an unrecognised kind, naming it, without failing sibling sheets', () => {
      const good: SheetRows = {
        sheetName: 'Good',
        rows: [OP_LABELS, opValues('Ascenty - JDI01', 'Abastecimento'), [], PRODUCT_HEADER, productRow('6098')],
      }
      const bad: SheetRows = {
        sheetName: 'Bad',
        rows: [OP_LABELS, opValues('Ascenty - JDI01', 'Devolução Total'), [], PRODUCT_HEADER, productRow('6098')],
      }

      const result = locateRestockingOperations([good, bad])

      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].sheetName).toBe('Good')
      expect(result.unparseableSheets).toEqual([
        expect.objectContaining({ sheetName: 'Bad', reason: expect.stringContaining('Devolução Total') }),
      ])
    })
  })

  describe('missing required columns', () => {
    it('reports every required product column absent from the shared header', () => {
      const missingDetail = PRODUCT_HEADER.filter(h => h !== 'Detalhes das Remoções')
      const sheet: SheetRows = {
        sheetName: 'Operação 1',
        rows: [OP_LABELS, opValues('Ascenty - JDI01', 'Abastecimento'), [], missingDetail, productRow('6098')],
      }

      const result = locateRestockingOperations([sheet])

      expect(result.missingRequiredColumns).toContain('removalDetail')
    })
  })

  describe('inconsistent header rows', () => {
    it('flags when sheets disagree on where the product table is', () => {
      const normal: SheetRows = {
        sheetName: 'Normal',
        rows: [OP_LABELS, opValues('Ascenty - JDI01', 'Abastecimento'), [], PRODUCT_HEADER, productRow('6098')],
      }
      const shifted: SheetRows = {
        sheetName: 'Shifted',
        rows: [OP_LABELS, opValues('Ascenty - SP02', 'Abastecimento'), PRODUCT_HEADER, productRow('6098')],
      }

      const result = locateRestockingOperations([normal, shifted])

      expect(result.inconsistentHeaderRows).toBe(true)
      expect(result.headerRowNumber).toBeNull()
    })
  })
})
