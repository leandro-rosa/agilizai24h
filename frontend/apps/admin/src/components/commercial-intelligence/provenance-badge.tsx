"use client";

import { StatusBadge } from "@/components/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Provenance } from "@/lib/commercial-intelligence/types";

/**
 * "Observado" (recorded facts and what is derived from them with no assumption)
 * versus "Estimado" (a projection, or anything that rests on an assumption,
 * including one typed by the viewer). The tooltip carries the label the
 * financial memory of the project uses for the same distinction.
 */
const LABELS: Record<Provenance, { badge: "Observado" | "Estimado"; rule: string; explanation: string }> = {
  fact: { badge: "Observado", rule: "FATO", explanation: "Registrado como aconteceu." },
  derived: { badge: "Observado", rule: "MÉTRICA DERIVADA", explanation: "Calculado a partir de fatos, sem nenhuma premissa." },
  assumption: { badge: "Estimado", rule: "PREMISSA", explanation: "Um valor assumido, não medido." },
  estimate: { badge: "Estimado", rule: "ESTIMATIVA", explanation: "Uma projeção que depende de uma premissa." },
};

export function ProvenanceBadge({ provenance, className }: { provenance: Provenance; className?: string }) {
  const { badge, rule, explanation } = LABELS[provenance];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={0}>
          <StatusBadge tone={badge === "Observado" ? "neutral" : "attention"} className={className}>
            {badge}
          </StatusBadge>
          <span className="sr-only"> ({rule})</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-medium">{rule}.</span> {explanation}
      </TooltipContent>
    </Tooltip>
  );
}
