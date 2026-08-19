import { fetchBaseQuery, retry } from "@reduxjs/toolkit/query/react";
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from "@reduxjs/toolkit/query/react";

/**
 * `gateway-service` is the platform's single HTTP entrypoint — every domain
 * slice points here, never at a domain service directly (design of
 * `backend/apps/gateway-service`).
 *
 * `NEXT_PUBLIC_GATEWAY_URL` because this runs in the browser: RTK Query's
 * `fetchBaseQuery` executes client-side, and Next has no client-side runtime
 * env — the value is inlined at build time (see the Dockerfile/compose for
 * how admin-prod's differs from admin-dev's).
 */
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3080";

const rawBaseQuery = fetchBaseQuery({
  baseUrl: GATEWAY_URL,
  // The session is an HTTP-only cookie the gateway sets; this is what makes
  // the browser attach it on a cross-origin request (admin and gateway are
  // different origins even in dev — different ports on localhost).
  credentials: "include",
});

/**
 * Wraps `fetchBaseQuery` with the two cross-cutting rules every domain slice
 * needs, following `gateway-service`'s own failure semantics table:
 *
 * - **401** — no session, or an expired one. Sends the operator back to
 *   login with a full navigation, not client-side routing: a stale
 *   Redux/RTK Query cache from the previous session must not survive into
 *   the next login.
 * - **503** — the gateway couldn't even find out (IAM or a domain service
 *   unreachable), which is a transient infrastructure problem, not a
 *   session problem — retried automatically with backoff instead.
 *
 * **403** is deliberately left untouched: authenticated but forbidden,
 * never a logout (the one status this layer must NOT react to the same way
 * as 401). It reaches the calling screen as an ordinary query error for
 * `RequestState` to render as a permission message.
 */
const withSessionHandling: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  if (result.error?.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    // Deliberately a full navigation, not `useRouter()`/`redirect()`: this
    // runs inside a baseQuery, outside any component's render or event
    // handler, and a client-side route change would leave the previous
    // session's Redux/RTK Query cache mounted into the next login.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  if (result.error && result.error.status !== 503) {
    // Bails out of `retry`'s automatic backoff for everything except a 503 —
    // retrying a 401/403/404/etc. would just repeat the same outcome slower.
    retry.fail(result.error);
  }

  return result;
};

export const gatewayBaseQuery = retry(withSessionHandling, { maxRetries: 3 });
