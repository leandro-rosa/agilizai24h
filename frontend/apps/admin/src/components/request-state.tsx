"use client";

import type { FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import type { SerializedError } from "@reduxjs/toolkit";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type QueryError = FetchBaseQueryError | SerializedError | undefined;

function statusOf(error: QueryError): number | string | undefined {
  return error && "status" in error ? error.status : undefined;
}

/**
 * The one place loading, empty, error and forbidden are told apart — every
 * data-backed screen renders through this rather than improvising its own
 * `if (isLoading)` chain, so the four states stay visually consistent and
 * none of them is ever silently skipped.
 *
 * A 403 is deliberately its own branch, not folded into the generic error:
 * the operator is authenticated, just not permitted — `gatewayBaseQuery`
 * already never logs them out for it, and this is where that distinction
 * becomes something they can read.
 */
export function RequestState({
  isLoading,
  error,
  isEmpty,
  emptyMessage = "Nada para mostrar.",
  onRetry,
  loadingRows = 4,
  children,
}: {
  isLoading: boolean;
  error?: QueryError;
  isEmpty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  loadingRows?: number;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-live="polite" aria-label="Carregando">
        {Array.from({ length: loadingRows }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    const status = statusOf(error);

    if (status === 403) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">Sem permissão</p>
          <p className="text-sm text-muted-foreground">
            Sua conta não tem acesso a esta informação. Fale com quem administra o painel se isso não deveria ser
            assim.
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium text-destructive">Não foi possível carregar os dados</p>
        <p className="text-sm text-muted-foreground">
          {status === 503 || status === 502
            ? "O serviço está temporariamente indisponível."
            : "Tente novamente em instantes."}
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return children;
}
