"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info, OctagonAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { QualityItem, QualitySeverity } from "@/lib/commercial-intelligence/quality";
import { cn } from "@/lib/utils";

const SEVERITY: Record<QualitySeverity, { label: string; Icon: typeof Info; frame: string; icon: string }> = {
  critical: { label: "Crítico", Icon: OctagonAlert, frame: "border-destructive/30 bg-destructive/12", icon: "text-destructive" },
  attention: { label: "Atenção", Icon: AlertTriangle, frame: "border-warning/30 bg-warning/12", icon: "text-warning" },
  info: { label: "Informação", Icon: Info, frame: "border-border bg-muted/40", icon: "text-muted-foreground" },
};

const MAX_DETAILS = 8;

/**
 * Every data problem that changes how far the numbers can be trusted, each with
 * what it does to them. Open by default when anything is critical or needs
 * attention, folded when there is only context; the reader's own choice wins
 * over that default once made. The severity is spelled out, never colour alone.
 */
export function DataQualityBanner({ items }: { items: QualityItem[] }) {
  const needsAttention = items.some((item) => item.severity !== "info");
  // Null until the reader chooses: the default follows the data, so it needs no effect to update.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? needsAttention;

  if (items.length === 0) return null;

  const counts = (["critical", "attention", "info"] as const).map((severity) => ({ severity, count: items.filter((item) => item.severity === severity).length })).filter((row) => row.count > 0);

  return (
    <section aria-label="Qualidade dos dados" className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-medium">
          Qualidade dos dados
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {counts.map((row) => `${row.count} ${SEVERITY[row.severity].label.toLowerCase()}`).join(" · ")}
          </span>
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setChosen(!open)} aria-expanded={open}>
          {open ? "Recolher" : "Ver detalhes"}
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </div>

      {open && (
        <ul className="flex flex-col gap-2 px-4 pb-4">
          {items.map((item) => {
            const { label, Icon, frame, icon } = SEVERITY[item.severity];
            return (
              <li key={item.id} className={cn("flex gap-3 rounded-lg border p-3", frame)}>
                <Icon className={cn("mt-0.5 size-4 shrink-0", icon)} aria-hidden />
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <p className="font-medium">
                    <span className="sr-only">{label}: </span>
                    {item.title}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Efeito: </span>
                    {item.effect}
                  </p>
                  {item.details.length > 0 && (
                    <ul className="list-disc pl-4 text-xs text-muted-foreground">
                      {item.details.slice(0, MAX_DETAILS).map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                      {item.details.length > MAX_DETAILS && <li>e mais {item.details.length - MAX_DETAILS}…</li>}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
