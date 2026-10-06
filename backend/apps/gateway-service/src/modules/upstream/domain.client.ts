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

  finance<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('finance', this.config.getOrThrow<string>('FINANCE_SERVICE_URL'), call)
  }

  sales<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('sales', this.config.getOrThrow<string>('SALES_SERVICE_URL'), call)
  }

  supply<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('supply', this.config.getOrThrow<string>('SUPPLY_SERVICE_URL'), call)
  }

  inventory<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('inventory', this.config.getOrThrow<string>('INVENTORY_SERVICE_URL'), call)
  }

  suppliers<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('suppliers', this.config.getOrThrow<string>('SUPPLIERS_SERVICE_URL'), call)
  }

  treasury<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('treasury', this.config.getOrThrow<string>('TREASURY_SERVICE_URL'), call)
  }

  accounting<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('accounting', this.config.getOrThrow<string>('ACCOUNTING_SERVICE_URL'), call)
  }

  billing<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('billing', this.config.getOrThrow<string>('BILLING_SERVICE_URL'), call)
  }

  capex<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('capex', this.config.getOrThrow<string>('CAPEX_SERVICE_URL'), call)
  }

  ingestion<T>(call: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    return this.call<T>('ingestion', this.config.getOrThrow<string>('INGESTION_SERVICE_URL'), call)
  }

  /**
   * The analysis reads every store for six months on a cold cache, so it gets
   * its own, longer budget than the 3 s / 5 s of a single-service lookup.
   */
  intelligence<T>({ path, ...rest }: Omit<UpstreamCall, 'service' | 'url'> & { path: string }) {
    const timeout = this.config.get<number>('INTELLIGENCE_TIMEOUT_MS') ?? 60000

    return this.upstream.send<T>(
      { ...rest, service: 'intelligence', url: `${this.config.getOrThrow<string>('INTELLIGENCE_SERVICE_URL')}${path}` },
      timeout,
      timeout + 5000,
    )
  }

  private call<T>(
    service: string,
    baseUrl: string,
    { path, ...rest }: Omit<UpstreamCall, 'service' | 'url'> & { path: string },
  ) {
    return this.upstream.send<T>({ ...rest, service, url: `${baseUrl}${path}` }, this.timeoutMs, this.deadlineMs)
  }
}
