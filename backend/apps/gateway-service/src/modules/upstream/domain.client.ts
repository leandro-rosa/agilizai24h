import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { UpstreamClient, type UpstreamCall } from './upstream.client'

/**
 * Typed access to the domain services. Each method names the service, so a
 * failure can be attributed to a specific upstream rather than reported as a
 * generic gateway error.
 */
@Injectable()
export class DomainClient {
  constructor(
    private readonly upstream: UpstreamClient,
    private readonly config: ConfigService,
  ) {}

  private get timeoutMs(): number {
    return this.config.get<number>('UPSTREAM_TIMEOUT_MS') ?? 3000
  }

  private get deadlineMs(): number {
    return this.config.get<number>('UPSTREAM_DEADLINE_MS') ?? 5000
  }

  stores<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('stores', this.config.getOrThrow<string>('STORES_SERVICE_URL'), call)
  }

  products<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('products', this.config.getOrThrow<string>('PRODUCTS_SERVICE_URL'), call)
  }

  private call<T>(
    service: string,
    baseUrl: string,
    { path, ...rest }: Omit<UpstreamCall, 'service' | 'url'> & { path: string },
  ) {
    return this.upstream.send<T>({ ...rest, service, url: `${baseUrl}${path}` }, this.timeoutMs, this.deadlineMs)
  }
}
