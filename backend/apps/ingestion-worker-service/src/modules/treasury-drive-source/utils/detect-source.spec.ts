import { detectTreasurySheetSource } from './detect-source'
import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'

function sheet(rows: unknown[][]): SheetRows[] {
  return [{ sheetName: 'Sheet1', rows }]
}

describe('detectTreasurySheetSource', () => {
  it('detects an Itaú statement by its Agência/Conta/Período header block', () => {
    const rows = [
      [null, null, null],
      ['Atualização:', '15/09/2026 09:39:30', null],
      ['Nome:', 'F&R SOLUCOES EXPERIENCE', null],
      ['Agência:', '2059', null],
      ['Conta:', '0099676-5', null],
      [null, null, null],
      ['Lançamentos', null, null],
      ['Periodo:', '01/08/2026 até 31/08/2026', null],
    ]
    expect(detectTreasurySheetSource(sheet(rows), 'itau')).toBe('itau_statement')
  })

  it('detects a C6 statement by its Entrada(R$)/Saída(R$) header row', () => {
    const rows = [['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']]
    expect(detectTreasurySheetSource(sheet(rows), 'c6')).toBe('c6_statement')
  })

  it('detects a C6 invoice by its Nome no Cartão/Valor (em R$) header row', () => {
    const rows = [['Data de Compra', 'Nome no Cartão', 'Final do Cartão', 'Categoria', 'Descrição', 'Parcela', 'Valor (em US$)', 'Cotação (em R$)', 'Valor (em R$)', 'Tipo', 'detalhe']]
    expect(detectTreasurySheetSource(sheet(rows), 'c6')).toBe('c6_invoice')
  })

  it('returns null for a sheet matching no known signature — never guesses', () => {
    const rows = [['Something', 'Unrelated', 'Header']]
    expect(detectTreasurySheetSource(sheet(rows), 'c6')).toBeNull()
  })

  it('returns null when the bank folder is not one this phase recognizes', () => {
    const rows = [['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe']]
    expect(detectTreasurySheetSource(sheet(rows), 'nubank')).toBeNull()
  })
})
