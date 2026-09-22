"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LossReason, ReasonDiagnosis } from "@/lib/loss-intelligence/types";

const REASON_LABELS: Record<LossReason, string> = { expired: "Validade", damaged_product: "Danificado", other_reason: "Outro motivo" };

/** "Ver detalhes técnicos" dentro do drawer — mostra sinais/regras acionadas por motivo, escondido por padrão. */
export function RulesFiredDetail({ diagnoses }: { diagnoses: ReasonDiagnosis[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
        {open ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
        Ver regras acionadas
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t p-3 text-sm">
          {diagnoses.map((diagnosis) => (
            <div key={diagnosis.reason}>
              <p className="font-medium">{REASON_LABELS[diagnosis.reason]}</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {diagnosis.regrasAcionadas.map((rule) => (
                  <li key={rule}>
                    <code>{rule}</code>
                  </li>
                ))}
              </ul>
              {diagnosis.hipoteses.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Hipóteses a investigar (não afirmadas): {diagnosis.hipoteses.join(", ")}.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
