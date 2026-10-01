import type { SheetRow } from '../../src/modules/baseline/pricing-sheet.parser'

/**
 * Rows shaped like the real pricing sheet ("precificação(1).xlsx", 2026-09-30):
 * float SKUs the way a spreadsheet stores them, the two SKUs that really appear
 * twice (6024 with conflicting packaging, 9987 identical), and the blank/error
 * filler a sheet ends with. Product data copied from the sheet; it is catalogue
 * data, not sales, and is only ever used in memory or a disposable database.
 */
export const PRICING_SHEET_ROWS: SheetRow[] = [
  { SKU: 5050.0, Produto: 'Arroz branco e strogonoff de frango', 'qtd itens por loja': 4, Medida: 'unidade' },
  { SKU: 1070.0, Produto: 'coca cola lata', 'qtd itens por loja': 12, Medida: 'fardo' },
  { SKU: 1071.0, Produto: 'coca cola zero lata', 'qtd itens por loja': 12, Medida: 'fardo' },
  { SKU: 5012.0, Produto: 'Trident Chiclete Sem Açúcar Sabor Menta', 'qtd itens por loja': 21, Medida: 'caixa' },
  { SKU: 5003.0, Produto: 'Pacoquita Sta Helena 20g', 'qtd itens por loja': 12, Medida: 'caixa' },
  { SKU: 1014.0, Produto: 'Nestle Kit Kat Chocolate 4 Finger 41,5G', 'qtd itens por loja': 20, Medida: 'caixa' },
  { SKU: 6098.0, Produto: 'ENERGETICO MONSTER ULTRA 473ML', 'qtd itens por loja': 6, Medida: 'fardo' },
  { SKU: 1072.0, Produto: 'guaraná 2l', 'qtd itens por loja': 6, Medida: 'fardo' },
  { SKU: 6030.0, Produto: 'Marmita - Arroz branco, couve e feijoada light', 'qtd itens por loja': 4, Medida: 'unidade' },
  { SKU: 100018.0, Produto: 'Arroz branco, couve e feijoada light', 'qtd itens por loja': 4, Medida: 'unidade' },
  // Same SKU twice, conflicting packaging (the real 6024).
  { SKU: 6024.0, Produto: 'M&Ms Cookies 35g', 'qtd itens por loja': 10, Medida: 'caixa' },
  // Same SKU twice, identical (the real 9987).
  { SKU: 9987.0, Produto: 'MENTOS STICK 37,5G - FRUIT - UN - PERFETTI VAN MELLE', 'qtd itens por loja': 16, Medida: 'caixa' },
  { SKU: 9987.0, Produto: 'MENTOS STICK 37,5G - FRUIT - UN - PERFETTI VAN MELLE', 'qtd itens por loja': 16, Medida: 'caixa' },
  { SKU: 6024.0, Produto: 'M&Ms Cookies 35g', 'qtd itens por loja': 10, Medida: 'unidade' },
  // A SKU the catalogue does not know.
  { SKU: 100125.0, Produto: 'Chá Matte Leão Ice Tea Limão Zero Lata', 'qtd itens por loja': 6, Medida: 'fardo' },
  // Filler at the end of the sheet.
  { SKU: null, Produto: null, 'qtd itens por loja': '#ERROR!', Medida: null },
  { SKU: '', Produto: '', 'qtd itens por loja': null, Medida: null },
]
