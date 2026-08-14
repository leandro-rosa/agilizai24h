import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { FetchedCatalogProduct } from '@app/quote-search-match'

/**
 * `backend/apps/search`'s own bulk-get-by-id limit
 * (`MAX_BULK_IDS`, `apps/search/.../product-bundle.constants.ts`) — not
 * shared via `@app/quote-search-match` since it's a plain protocol detail,
 * not a security boundary; kept in sync by hand, low risk if it drifts
 * (worst case: an oversized request gets truncated search-api-side).
 */
const MAX_BULK_PRODUCT_IDS = 50

/**
 * apps/quote's only outbound HTTP call to apps/search (everything else
 * between the two is BullMQ, see @app/quote-search-match) — fetches fresh
 * product data at export time so a generated export reflects the real
 * catalog's current state for the fields a reviewer selected, not only
 * the narrower snapshot captured at match time. First real consumer of
 * @app/http-client in this app.
 */
@Injectable()
export class SearchCatalogService {
  private readonly logger = new Logger(SearchCatalogService.name)

  constructor(
    private readonly httpClient: AxiosHttpClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Best-effort: a chunk that fails to fetch is logged and simply omitted
   * from the result (never throws) — callers must treat a missing id as
   * "fall back to the stored snapshot for this product", not as a fatal
   * error for the whole batch.
   */
  async getProductsByIds(ids: string[]): Promise<FetchedCatalogProduct[]> {
    const uniqueIds = [...new Set(ids)].filter(Boolean)
    if (uniqueIds.length === 0) {
      return []
    }

    const baseUrl = this.configService.get<string>('SEARCH_API_URL')
    const chunks: string[][] = []
    for (let i = 0; i < uniqueIds.length; i += MAX_BULK_PRODUCT_IDS) {
      chunks.push(uniqueIds.slice(i, i + MAX_BULK_PRODUCT_IDS))
    }

    const results = await Promise.all(
      chunks.map(async chunk => {
        try {
          const response = await this.httpClient.send<{ items: FetchedCatalogProduct[] }>({
            http_method: 'GET',
            url: `${baseUrl}/v1/products?ids=${chunk.map(encodeURIComponent).join(',')}`,
            timeout: 8_000,
            throw_on_exception: true,
          })
          return response.response.data?.items ?? []
        } catch (error) {
          this.logger.warn(
            { error: error instanceof Error ? error.message : error, count: chunk.length },
            'SEARCH_CATALOG_FETCH_FAILED',
          )
          return []
        }
      }),
    )

    return results.flat()
  }
}
