import { Injectable, Logger } from '@nestjs/common'
import { ElasticsearchClientService } from '@app/elasticsearch'
import {
  QUOTE_DEMO_PRODUCTS_INDEX,
  QUOTE_DEMO_PRODUCTS_INDEX_SETTINGS,
  QUOTE_DEMO_PRODUCTS_MAPPING,
} from './product-catalog-seed.constants'
import { DEMO_PRODUCTS_SEED } from './demo-products.seed'

@Injectable()
export class ProductCatalogSeedService {
  private readonly logger = new Logger(ProductCatalogSeedService.name)

  constructor(private readonly elasticsearch: ElasticsearchClientService) {}

  /**
   * Idempotent: creates the index only if missing, then indexes each demo
   * document by its stable `productId` (used as the ES `_id`), so running
   * this twice updates in place rather than duplicating documents.
   */
  async run(): Promise<{ index: string; indexed: number }> {
    const client = this.elasticsearch.getInstance()

    const exists = await client.indices.exists({ index: QUOTE_DEMO_PRODUCTS_INDEX })
    if (!exists) {
      await client.indices.create({
        index: QUOTE_DEMO_PRODUCTS_INDEX,
        settings: QUOTE_DEMO_PRODUCTS_INDEX_SETTINGS as any,
        mappings: QUOTE_DEMO_PRODUCTS_MAPPING as any,
      })
      this.logger.log({ index: QUOTE_DEMO_PRODUCTS_INDEX }, 'QUOTE_DEMO_PRODUCTS_INDEX_CREATED')
    }

    const operations = DEMO_PRODUCTS_SEED.flatMap(doc => [
      { index: { _index: QUOTE_DEMO_PRODUCTS_INDEX, _id: doc.productId } },
      doc,
    ])

    const result = await client.bulk({ refresh: true, operations })
    if (result.errors) {
      const failed = result.items.filter((item: any) => item.index?.error)
      this.logger.error({ failed }, 'QUOTE_DEMO_PRODUCTS_SEED_PARTIAL_FAILURE')
      throw new Error(`Failed to index ${failed.length} of ${DEMO_PRODUCTS_SEED.length} demo products`)
    }

    this.logger.log(
      { index: QUOTE_DEMO_PRODUCTS_INDEX, indexed: DEMO_PRODUCTS_SEED.length },
      'QUOTE_DEMO_PRODUCTS_SEED_COMPLETE',
    )
    return { index: QUOTE_DEMO_PRODUCTS_INDEX, indexed: DEMO_PRODUCTS_SEED.length }
  }
}
