import type { BaseQueryFn } from "@reduxjs/toolkit/query";
import type { FetchArgs, FetchBaseQueryError } from "@reduxjs/toolkit/query/react";

type FetchWithBQ = (
  args: string | FetchArgs,
) => ReturnType<BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError>>;

/**
 * One request in a fan-out (per month, per store) whose 404 means a real,
 * meaningful "no data for this one", not a failure — `never-ingested` reads
 * that way everywhere else in this app. Any *other* error (403, 500,
 * unreachable) is a genuine failure and must not be swallowed as if it were
 * the same "no data" case, or a permission or outage problem would render
 * as a quiet gap in a chart instead of the error state it actually is.
 */
export async function fetchOr404<T>(
  fetchWithBQ: FetchWithBQ,
  url: string,
): Promise<{ data?: T; error?: FetchBaseQueryError }> {
  const result = await fetchWithBQ(url);
  if (result.error) {
    if (result.error.status === 404) return {};
    return { error: result.error };
  }
  return { data: result.data as T };
}

/** The first real (non-404) error found across a fan-out, if any — the queryFn should fail with this rather than proceed. */
export function firstError(results: { error?: FetchBaseQueryError }[]): FetchBaseQueryError | undefined {
  return results.find((r) => r.error)?.error;
}
