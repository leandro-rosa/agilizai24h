# common/nest-libs/http-client

`HttpClientModule` (global) wraps `@nestjs/axios` with retry/backoff and a
thin GraphQL convenience layer. Not imported by any app today — no current
consumer, added ahead of any confirmed outbound HTTP integration (no apps
exist under `backend/apps` yet).

## Public API

- `AxiosHttpClient.send<T>(request: RequestDTO)` — retries up to 12 times
  with exponential backoff (300ms base, capped ~9.6s) on HTTP 429 or
  `ECONNABORTED` only; any other error fails immediately. Throws only when
  `request.throw_on_exception` is set; otherwise returns
  `{ response: { error } }` instead of throwing, so callers that don't pass
  that flag must check `response.error` themselves rather than relying on
  a caught exception.
- `GraphQLClientService.executeQuery<T>({ url, query, variables, ... })` —
  POSTs a GraphQL request through `AxiosHttpClient.send`; same
  throw/no-throw behavior applies.

## Known gaps

- No timeout default is applied unless the caller passes one in `RequestDTO`
  — `AxiosRequestConfig.timeout` stays `undefined` otherwise, so a hung
  request can retry for a long time before the 12-attempt cap is reached.
- No per-host or per-integration configuration (base URL, auth headers) —
  every call site supplies the full URL and headers itself.
