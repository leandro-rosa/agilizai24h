import { Injectable } from '@nestjs/common'
import { ElasticsearchClientService } from '@app/elasticsearch'
import { QUOTE_DEMO_PRODUCTS_INDEX } from '../../product-catalog-seed/product-catalog-seed.constants'
import { ProductCatalogDocument } from '../../product-catalog-seed/product-catalog-document'

const SEARCHABLE_FIELDS = ['sku', 'ean', 'mainCode', 'oemCodes', 'tradeNumbers', 'name', 'brand']

@Injectable()
export class QuoteProductsService {
  constructor(private readonly elasticsearch: ElasticsearchClientService) {}

  /**
   * Manual product search (Etapa 5's "Buscar peça"). `fields`, when given,
   * restricts which document fields are queried — otherwise all
   * SEARCHABLE_FIELDS are tried, weighted so exact-code fields outrank a
   * loose name match.
   */
  async search(term: string, fields?: string[]): Promise<ProductCatalogDocument[]> {
    const targetFields = fields?.length ? fields.filter(field => SEARCHABLE_FIELDS.includes(field)) : SEARCHABLE_FIELDS

    const query = {
      bool: {
        should: targetFields.map(field => ({
          match: { [field]: { query: term, boost: field === 'name' || field === 'brand' ? 1 : 3 } },
        })),
        minimum_should_match: 1,
      },
    }

    return this.elasticsearch.search<ProductCatalogDocument>(QUOTE_DEMO_PRODUCTS_INDEX, query, 20)
  }

  /** Bulk fetch for the up-to-3 product comparison panel. */
  async getByIds(ids: string[]): Promise<ProductCatalogDocument[]> {
    return this.elasticsearch.mget<ProductCatalogDocument>(QUOTE_DEMO_PRODUCTS_INDEX, ids)
  }

  /**
   * Structured candidate lookup for MatchItemWorker — one `should` clause
   * per mapped, non-empty search field (term-level for exact/array fields,
   * `match` for name/brand), rather than a single free-text query. Scoring
   * itself happens in candidate-scoring.util against the raw documents
   * this returns, so ranking reflects this app's own explainable rules
   * rather than Elasticsearch's opaque `_score`.
   */
  async matchCandidates(fields: Array<{ targetField: string; value: string }>): Promise<ProductCatalogDocument[]> {
    const clauses: Record<string, unknown>[] = []

    for (const { targetField, value } of fields) {
      if (!value) continue
      if (targetField === 'sku') clauses.push({ term: { sku: value } })
      if (targetField === 'ean') clauses.push({ term: { ean: value } })
      if (targetField === 'main_code') clauses.push({ term: { mainCode: value } })
      if (targetField === 'oem') clauses.push({ term: { oemCodes: value } })
      if (targetField === 'trade_number') clauses.push({ term: { tradeNumbers: value } })
      if (targetField === 'name') clauses.push({ match: { name: value } })
      if (targetField === 'brand') clauses.push({ match: { brand: value } })
    }

    if (!clauses.length) {
      return []
    }

    return this.elasticsearch.search<ProductCatalogDocument>(
      QUOTE_DEMO_PRODUCTS_INDEX,
      { bool: { should: clauses, minimum_should_match: 1 } },
      10,
    )
  }
}
