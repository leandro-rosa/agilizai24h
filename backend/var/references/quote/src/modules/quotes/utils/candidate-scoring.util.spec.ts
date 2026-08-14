import { ProductCatalogDocument } from '../../product-catalog-seed/product-catalog-document'
import { scoreCandidate } from './candidate-scoring.util'

function candidateWith(overrides: Partial<ProductCatalogDocument> = {}): ProductCatalogDocument {
  return {
    productId: 'product-1',
    name: '',
    brand: '',
    category: '',
    sku: '',
    ean: '',
    mainCode: '',
    oemCodes: [],
    tradeNumbers: [],
    stock: 0,
    ...overrides,
  }
}

describe('scoreCandidate', () => {
  it('awards full credit for an identical normalized name', () => {
    const result = scoreCandidate(
      [{ targetField: 'name', value: '  Filtro de Óleo  ', priority: 1 }],
      candidateWith({ name: 'filtro de oleo' }),
    )

    expect(result).toEqual({ score: 100, reasons: ['Nome idêntico'] })
  })

  it('awards full credit for an identical normalized brand', () => {
    const result = scoreCandidate(
      [{ targetField: 'brand', value: 'MANN-FILTER', priority: 1 }],
      candidateWith({ brand: 'mann filter' }),
    )

    expect(result).toEqual({ score: 100, reasons: ['Marca idêntica'] })
  })

  it('awards token-overlap credit proportionally instead of a fixed half-weight', () => {
    const result = scoreCandidate(
      [{ targetField: 'name', value: 'filtro oleo motor diesel', priority: 1 }],
      candidateWith({ name: 'filtro oleo motor premium' }),
    )

    expect(result).toEqual({ score: 60, reasons: ['Nome semelhante (60% dos tokens)'] })
  })

  it.each([
    ['sku', 'SKU-123', { sku: 'sku-123' }, 'SKU idêntico'],
    ['ean', '7891234567890', { ean: '7891234567890' }, 'EAN idêntico'],
    ['main_code', 'ABC-42', { mainCode: 'abc-42' }, 'Código principal idêntico'],
  ] as const)('awards full credit for exact %s codes', (targetField, value, candidateFields, reason) => {
    const result = scoreCandidate([{ targetField, value, priority: 9 }], candidateWith(candidateFields))

    expect(result).toEqual({ score: 100, reasons: [reason] })
  })

  it('applies configured field weights only to evidence that actually matches', () => {
    const result = scoreCandidate(
      [
        { targetField: 'name', value: 'Filtro de oleo', priority: 9 },
        { targetField: 'brand', value: 'Bosch', priority: 1 },
      ],
      candidateWith({ name: 'Filtro de oleo', brand: 'Mann' }),
      { fieldWeights: { name: 3, brand: 1 } },
    )

    expect(result).toEqual({ score: 75, reasons: ['Nome idêntico'] })
  })

  it('matches quote-specific synonym groups in both directions with an explicit reason', () => {
    const synonymGroups = [{ field: 'name', terms: ['amortecedor', 'damper'] }] as const
    const options = { synonymGroups }

    expect(
      scoreCandidate(
        [{ targetField: 'name', value: 'amortecedor', priority: 1 }],
        candidateWith({ name: 'damper' }),
        options,
      ),
    ).toEqual({ score: 100, reasons: ['Nome por sinônimo configurado'] })
    expect(
      scoreCandidate(
        [{ targetField: 'name', value: 'damper', priority: 1 }],
        candidateWith({ name: 'amortecedor' }),
        options,
      ),
    ).toEqual({ score: 100, reasons: ['Nome por sinônimo configurado'] })
    expect(
      scoreCandidate(
        [{ targetField: 'name', value: 'amortecedor', priority: 1 }],
        candidateWith({ name: 'damper' }),
      ),
    ).toEqual({ score: 0, reasons: [] })
  })

  it('never applies a synonym group configured for brand to name', () => {
    const result = scoreCandidate(
      [{ targetField: 'name', value: 'mann', priority: 1 }],
      candidateWith({ name: 'elemento filtrante' }),
      { synonymGroups: [{ field: 'brand', terms: ['mann', 'elemento filtrante'] }] },
    )

    expect(result).toEqual({ score: 0, reasons: [] })
  })

  it('uses safe evidence labels for protected identifiers without receiving their values', () => {
    const result = scoreCandidate(
      [
        { targetField: 'oem', value: 'protected-oem-value', priority: 1 },
        { targetField: 'trade_number', value: 'protected-trade-value', priority: 1 },
      ],
      candidateWith({ oemCodes: [], tradeNumbers: [] }),
      { evidenceLabels: ['oem', 'trade_number'] },
    )

    expect(result).toEqual({
      score: 100,
      reasons: ['OEM confirmado por evidência', 'Trade Number confirmado por evidência'],
    })
  })

  it('does not turn text retrieval evidence into full confidence', () => {
    const result = scoreCandidate(
      [{ targetField: 'name', value: 'filtro oleo motor diesel', priority: 1 }],
      candidateWith({ name: 'filtro oleo motor premium' }),
      { evidence: [{ targetField: 'name', kind: 'text' }] },
    )

    expect(result).toEqual({ score: 60, reasons: ['Nome semelhante (60% dos tokens)'] })
  })

  it('uses synonym query evidence without exposing the protected indexed value', () => {
    const result = scoreCandidate(
      [{ targetField: 'oem', value: 'morcego', priority: 1 }],
      candidateWith(),
      { evidence: [{ targetField: 'oem', kind: 'synonym', searchFieldIndex: 0 }] },
    )

    expect(result).toEqual({ score: 100, reasons: ['OEM por sinônimo configurado'] })
  })

  it('applies structured evidence only to the search-field entry with the same index', () => {
    const result = scoreCandidate(
      [
        { targetField: 'oem', value: 'OEM-A', priority: 1 },
        { targetField: 'oem', value: 'OEM-B', priority: 1 },
      ],
      candidateWith(),
      { evidence: [{ targetField: 'oem', kind: 'exact', searchFieldIndex: 1 }] },
    )

    expect(result).toEqual({ score: 50, reasons: ['OEM confirmado por evidência'] })
  })

  it('awards no score and emits no reasons for fields without evidence', () => {
    const result = scoreCandidate(
      [
        { targetField: 'name', value: 'Pastilha de freio', priority: 1 },
        { targetField: 'oem', value: 'OEM-123', priority: 1 },
      ],
      candidateWith({ name: 'Filtro de ar', oemCodes: [] }),
      { evidenceLabels: ['unsupported'] },
    )

    expect(result).toEqual({ score: 0, reasons: [] })
  })

  it('always clamps the score to the 0..100 range', () => {
    expect(
      scoreCandidate(
        [{ targetField: 'name', value: 'Filtro', priority: 1 }],
        candidateWith({ name: 'Filtro' }),
        { fieldWeights: { name: Number.POSITIVE_INFINITY } },
      ).score,
    ).toBe(100)
    expect(
      scoreCandidate(
        [{ targetField: 'name', value: 'Filtro', priority: 1 }],
        candidateWith({ name: 'Filtro' }),
        { fieldWeights: { name: -10 } },
      ).score,
    ).toBe(0)
    expect(
      scoreCandidate(
        [
          { targetField: 'name', value: 'Filtro', priority: 1 },
          { targetField: 'brand', value: 'Bosch', priority: 1 },
        ],
        candidateWith({ name: 'Filtro', brand: 'Mann' }),
        { fieldWeights: { name: Number.MAX_VALUE, brand: Number.MAX_VALUE } },
      ).score,
    ).toBe(50)
  })
})
