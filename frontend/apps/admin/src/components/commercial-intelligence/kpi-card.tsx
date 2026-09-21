"use client";

import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Provenance } from "@/lib/commercial-intelligence/types";
import { pct } from "./format";
import { ProvenanceBadge } from "./provenance-badge";

/** Where a KPI stands: shown, loading, or not available for a reason the reader can read. */
export type KpiState = { kind: "value" } | { kind: "loading" } | { kind: "unavailable"; reason: string };

export interface KpiDelta {
  /** Relative change; null when the periods cannot be compared. */
  pct: number | null;
  /** Whether the comparison period was asked for and loaded. */
  compared: boolean;
}

/**
 * The change against the comparison period. A change that cannot be computed is
 * "Sem comparação" — never a zero, never an arrow pointing nowhere.
 */
function Delta({ delta }: { delta: KpiDelta }) {
  if (!delta.compared || delta.pct === null) return <span className="text-xs text-muted-foreground">Sem comparação</span>;
  if (Math.abs(delta.pct) < 0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden /> estável
      </span>
    );
  }

  const up = delta.pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${up ? "text-success" : "text-destructive"}`}>
      <Icon className="size-3" aria-hidden />
      {`${up ? "+" : "−"}${pct(Math.abs(delta.pct))}`}
      <span className="sr-only"> em relação ao período de comparação</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  provenance,
  state = { kind: "value" },
  delta,
  note,
  warning,
}: {
  label: string;
  value: string;
  provenance: Provenance;
  state?: KpiState;
  delta?: KpiDelta;
  /** A line of context under the value. */
  note?: string;
  /** A caveat that changes how the value should be read; shown as a warning icon with the text. */
  warning?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-normal text-muted-foreground">
          <span className="flex items-center gap-1">
            {label}
            {warning && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex" aria-label={warning}>
                    <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{warning}</TooltipContent>
              </Tooltip>
            )}
          </span>
          <ProvenanceBadge provenance={provenance} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {state.kind === "loading" ? (
          <Skeleton className="h-7 w-28" role="status" aria-label="Carregando" />
        ) : state.kind === "unavailable" ? (
          <>
            <p className="tabular text-xl font-semibold text-muted-foreground">—</p>
            <p className="text-xs text-muted-foreground">{state.reason}</p>
          </>
        ) : (
          <>
            <p className="tabular text-xl font-semibold">{value}</p>
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              {note ? <span className="text-xs text-muted-foreground">{note}</span> : <span />}
              {delta && <Delta delta={delta} />}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
