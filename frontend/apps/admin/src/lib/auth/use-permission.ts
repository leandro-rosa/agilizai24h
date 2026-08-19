import { useGetMeQuery } from "@/lib/api/auth";

/**
 * Whether the current operator has a given permission — used to hide an
 * action they cannot use, e.g. an "editar" button.
 *
 * Hiding is a UX courtesy, never the security boundary: the gateway still
 * enforces every permission server-side and can still return 403 even for
 * an action this hook says is available (a permission revoked between this
 * check and the click, for one) — `RequestState` handles that 403 the same
 * way regardless of what was hidden here.
 *
 * Reuses `AuthGate`'s own `getMe` query rather than issuing a second
 * request: RTK Query dedupes identical in-flight/cached queries by key, so
 * this is the same cached result, not a new network call.
 */
export function useHasPermission(permission: string): boolean {
  const { data } = useGetMeQuery();
  return data?.permissions.includes(permission) ?? false;
}
