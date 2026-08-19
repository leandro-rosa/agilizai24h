import { Injectable, Logger } from '@nestjs/common'
import { AxiosHttpClient } from '@app/http-client'

export interface UpstreamCall {
  service: string
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  url: string
  payload?: unknown
  correlationId?: string
}

/**
 * A downstream response that reached us with a status — a domain answer, even
 * if it is a 404 or a 409.
 */
export interface UpstreamResponse<T> {
  status: number
  data: T
}

/**
 * The upstream service could not be reached at all (refused, timed out, DNS).
 * Distinct from a non-2xx answer, because the two mean different things to the
 * caller: one is "the data says no", the other is "we don't know".
 */
export class UpstreamUnreachableError extends Error {
  constructor(
    readonly service: string,
    readonly cause: unknown,
  ) {
    super(`Upstream ${service} is unreachable`)
  }
}

/** A downstream service answered with a non-2xx status. */
export class UpstreamStatusError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Upstream ${service} responded ${status}`)
  }
}

/**
 * Thin wrapper over @app/http-client that makes two of its behaviours usable
 * here — both are documented in this service's CLAUDE.md because neither is
 * obvious from the lib's signature:
 *
 * 1. `send()` throws the raw axios error, which still carries
 *    `error.response.status`. Passing `throw_on_exception: true` instead
 *    rethrows a plain Error and LOSES the status, so it is deliberately not
 *    used — without the status a 404 from a domain service is
 *    indistinguishable from the service being down.
 * 2. The lib retries up to 12 times with exponential backoff. Only 429 and
 *    ECONNABORTED are retryable, so a refused connection fails fast — but a
 *    timeout would retry for ~40s. An overall deadline is imposed here so the
 *    gateway always answers within a bounded time, which is what makes the
 *    "503 rather than a hung request" behaviour real.
 */
@Injectable()
export class UpstreamClient {
  private readonly logger = new Logger(UpstreamClient.name)

  constructor(private readonly http: AxiosHttpClient) {}

  async send<T>(call: UpstreamCall, timeoutMs: number, deadlineMs: number): Promise<UpstreamResponse<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (call.correlationId) headers['x-correlation-id'] = call.correlationId

    try {
      const result = await this.withDeadline(
        this.http.send<T>({
          http_method: call.method,
          url: call.url,
          payload: call.payload,
          headers,
          timeout: timeoutMs,
        }),
        deadlineMs,
        call.service,
      )

      return { status: Number(result.response.status ?? 200), data: result.response.data as T }
    } catch (error) {
      if (error instanceof UpstreamUnreachableError) throw error

      const status = (error as { response?: { status?: number; data?: unknown } })?.response?.status

      if (typeof status === 'number') {
        throw new UpstreamStatusError(call.service, status, (error as { response?: { data?: unknown } }).response?.data)
      }

      // No response at all: refused, DNS failure, or timed out.
      this.logger.error(`${call.service} unreachable at ${call.url}`)
      throw new UpstreamUnreachableError(call.service, error)
    }
  }

  private async withDeadline<T>(promise: Promise<T>, deadlineMs: number, service: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new UpstreamUnreachableError(service, 'deadline exceeded')), deadlineMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/** Maps an upstream failure onto what the caller should be told. */
export function describeUpstreamFailure(error: unknown): { unreachable: boolean; status?: number; body?: unknown } {
  if (error instanceof UpstreamUnreachableError) return { unreachable: true }
  if (error instanceof UpstreamStatusError) return { unreachable: false, status: error.status, body: error.body }

  return { unreachable: true }
}
