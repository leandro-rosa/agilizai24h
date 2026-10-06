/**
 * One GET against a sibling service with the global `fetch`. A 404 is `null` only when asked for; every other
 * failure throws, so a downed service is never read as "no data".
 */
export async function readJson<T>(url: string, options: { timeoutMs?: number; notFoundIsNull?: boolean; correlationId?: string } = {}): Promise<T | null> {
  const response = await fetch(url, {
    headers: options.correlationId ? { 'x-correlation-id': options.correlationId } : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  })
  if (response.status === 404 && options.notFoundIsNull) return null
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`)

  return (await response.json()) as T
}
