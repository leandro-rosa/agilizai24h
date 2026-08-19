"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useGetMeQuery } from "@/lib/api/auth";

/**
 * Guards every route under the `(app)` group behind a session.
 *
 * The session itself is an HTTP-only cookie the panel cannot read, so
 * `GET /auth/me` is the only way to know whether one exists. A 401 here is
 * handled globally by `gatewayBaseQuery` (full navigation to `/login`) —
 * this component only needs to keep the protected screen from rendering
 * with no data while that's in flight, and while it succeeds.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useGetMeQuery();

  if (isLoading || !data) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return children;
}
