import { AxiosHttpClient } from '@app/http-client'

/**
 * One GET against a sibling service. A 404 is a real answer for the callers that
 * ask for it ("that period was never ingested"), so it is returned as `null`
 * only when `notFoundIsNull` is set — every other failure throws and is never
 * folded into "no data".
 */
export async function httpGet<T>(
  http: AxiosHttpClient,
  url: string,
  options: { correlationId?: string; timeout?: number; notFoundIsNull?: boolean } = {},
): Promise<T | null> {
  try {
    const result = await http.send<T>({
      http_method: 'get',
      url,
      headers: options.correlationId ? { 'x-correlation-id': options.correlationId } : undefined,
      timeout: options.timeout ?? 30000,
    })

    return result.response.data as T
  } catch (error) {
    if (options.notFoundIsNull && (error as { response?: { status?: number } })?.response?.status === 404) return null
    throw error
  }
}
