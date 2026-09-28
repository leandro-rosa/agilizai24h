import { parsePlanogramaRow } from './parse-planograma-row'

const HEADER = ['Seleção', 'ID produto', 'Código Produto', 'Descrição Produto', 'Categoria produto', 'Preço', 'Código de barras', 'Capacidade mola', 'Mínimo crítico', 'Nível de par', 'Quant. atual', 'Tipo do Produto']
const columnIndex = Object.fromEntries(HEADER.map((h, i) => [h, i]))

describe('parsePlanogramaRow', () => {
  it('extracts codigoProduto, minimoCritico, nivelDePar and quantidadeAtual from a real-shaped row', () => {
    const row = [1, 329, '1093', 'Agua tonica', 'Bebidas', 7.9, '7891991000840', 0, 3, 6, 5, 'Público']
    expect(parsePlanogramaRow(row, columnIndex)).toEqual({ codigoProduto: '1093', minimoCritico: 3, nivelDePar: 6, quantidadeAtual: 5 })
  })

  it('treats a zero quantidade atual as a real, valid zero, not missing', () => {
    const row = [2, 367, '2258', 'Água', 'Bebidas', 5.5, '789', 0, 3, 6, 0, 'Público']
    expect(parsePlanogramaRow(row, columnIndex)?.quantidadeAtual).toBe(0)
  })

  it('returns null fields for genuinely blank minimo/par/atual cells rather than coercing to 0', () => {
    const row = [3, 400, '9999', 'Produto sem par', 'Snacks', 4.0, '789', 0, null, null, null, 'Público']
    expect(parsePlanogramaRow(row, columnIndex)).toEqual({ codigoProduto: '9999', minimoCritico: null, nivelDePar: null, quantidadeAtual: null })
  })

  it('returns null entirely when the row has no Código Produto', () => {
    const row = [4, 401, null, 'Linha inválida', 'Snacks', 4.0, '789', 0, 1, 2, 3, 'Público']
    expect(parsePlanogramaRow(row, columnIndex)).toBeNull()
  })
})
