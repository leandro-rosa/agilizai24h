import { PRODUCT_EXPORT_FIELDS } from '@app/quote-search-match'
import { extractMappedAttributeValue, extractProductExportValue } from './export-field-extraction.util'

const POPULATED_PRODUCT = {
  id: 42,
  product_name: 'Filtro de óleo',
  brand_mapped_name: 'Bosch',
  product_sku: 'FIL-90',
  ean: ['7891234567890', '7891234567891'],
  brand_mapped_code: 'BC-90',
  normalized_sku: 'fil90',
  inventories: [{ stock_quantity: 3 }, { stock_quantity: 2 }],
  gallery: [{ url: 'https://example.com/1.jpg' }, { url: 'https://example.com/2.jpg' }],
  search_application: Array.from({ length: 8 }, (_, i) => `VEICULO ${i}`),
}

describe('extractProductExportValue', () => {
  // Proves every PRODUCT_EXPORT_FIELDS entry reaches its own case, not the
  // `default` fallthrough — a field silently falling through would export
  // blank forever, exactly the bug this whole change replaces.
  it.each(PRODUCT_EXPORT_FIELDS.map(field => [field.id, field.sourceField] as const))(
    '%s (sourceField: %s) extracts a non-empty value from a populated product',
    (_id, sourceField) => {
      const value = extractProductExportValue(POPULATED_PRODUCT, sourceField)
      expect(value).not.toBe('')
      expect(value).not.toBeUndefined()
    },
  )

  it('joins every EAN with a comma', () => {
    expect(extractProductExportValue(POPULATED_PRODUCT, 'ean')).toBe('7891234567890, 7891234567891')
  })

  it('sums stock_quantity across every inventory entry', () => {
    expect(extractProductExportValue(POPULATED_PRODUCT, 'inventories')).toBe(5)
  })

  it('uses only the first gallery image', () => {
    expect(extractProductExportValue(POPULATED_PRODUCT, 'gallery')).toBe('https://example.com/1.jpg')
  })

  it('caps search_application at 5 entries', () => {
    const result = extractProductExportValue(POPULATED_PRODUCT, 'search_application') as string
    expect(result.split('; ')).toHaveLength(5)
  })

  it('returns empty/zero for an unpopulated product without throwing', () => {
    expect(extractProductExportValue({ id: 1 }, 'product_name')).toBe('')
    expect(extractProductExportValue({ id: 1 }, 'inventories')).toBe(0)
  })

  it('returns an empty string for an unrecognized sourceField instead of throwing', () => {
    expect(extractProductExportValue(POPULATED_PRODUCT, 'not_a_real_field')).toBe('')
  })
})

describe('extractMappedAttributeValue', () => {
  const product = {
    id: 1,
    mapped_attributes: {
      peso_liquido: { golden_record: { value: 1.5 } },
      peso_liquido_unidade: { golden_record: { value: 'kg' } },
      cor: { golden_record: { value: 'Preto' } },
      unidade_vazia: { golden_record: { value: '' } },
    },
  }

  it('returns just the value when no unit key is given', () => {
    expect(extractMappedAttributeValue(product, 'cor')).toBe('Preto')
  })

  it('combines value and unit when a unit key is given and resolves', () => {
    expect(extractMappedAttributeValue(product, 'peso_liquido', 'peso_liquido_unidade')).toBe('1.5 kg')
  })

  it('falls back to value-only when the unit key resolves to an empty value', () => {
    expect(extractMappedAttributeValue(product, 'peso_liquido', 'unidade_vazia')).toBe('1.5')
  })

  it('falls back to value-only when the unit key does not exist on the product', () => {
    expect(extractMappedAttributeValue(product, 'peso_liquido', 'chave_inexistente')).toBe('1.5')
  })

  it('returns an empty string when the value key is missing, regardless of a unit key', () => {
    expect(extractMappedAttributeValue(product, 'altura', 'peso_liquido_unidade')).toBe('')
  })

  it('returns an empty string for a product with no mapped_attributes at all', () => {
    expect(extractMappedAttributeValue({ id: 2 }, 'peso_liquido')).toBe('')
  })
})
