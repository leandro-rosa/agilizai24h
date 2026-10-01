import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'

/**
 * The ONE place this service writes to another service: setting a product's
 * packaging type ("Medida") in `products-service`, as an explicit, owner-
 * triggered step of the pricing-sheet import (design D12). It is kept apart
 * from the read-only source clients on purpose, and nothing in the engine
 * imports it — the engine recommends, it never acts.
 */
@Injectable()
export class ProductPackagingWriter {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  async setPackageType(productId: number, packageType: string, correlationId?: string): Promise<void> {
    await this.http.send({
      http_method: 'patch',
      url: `${this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL')}/products/${productId}`,
      payload: { packageType },
      headers: correlationId ? { 'x-correlation-id': correlationId } : undefined,
      timeout: 15000,
    })
  }
}
