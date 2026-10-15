"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetMeQuery } from "@/lib/api/auth";

/**
 * Guards every route under the `(app)` group behind a session.
 *
 * The session itself is an HTTP-only cookie the panel cannot read, so
 * `GET /auth/me` is the only way to know whether one exists. A 401 here is
 * handled globally by `gatewayBaseQuery` (full navigation to `/login`) —
 * this component only needs to keep the protected screen from rendering
 * with no data while that's in flight, and while it succeeds. Any other
 * failure (network, 5xx) gets a retry screen instead of a skeleton that
 * would never go away.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error, refetch } = useGetMeQuery();

  if (error && !isLoading && (!("status" in error) || error.status !== 401)) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
        <p className="text-base font-medium">Não foi possível carregar sua sessão.</p>
        <p className="text-sm text-muted-foreground">Verifique a conexão e tente novamente.</p>
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return children;
}
