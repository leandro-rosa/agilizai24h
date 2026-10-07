import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import type { LatestPricingReport } from "@/lib/api/pricing";

export interface SetupNote {
  text: string;
  /** Onde corrigir. */
  action?: { label: string; href?: string; onClick?: () => void };
}

/**
 * O que falta para os números valerem: taxa sem cadastro, alíquota sem valor e qualquer outra lacuna do relatório.
 * A tela nunca mostra produto "saudável" só porque um insumo faltou — o aviso existe sempre, e o que impede uma recomendação aparece no próprio produto.
 */
export function setupNotes(latest: LatestPricingReport): SetupNote[] {
  const notes: SetupNote[] = [];
  const report = latest.report;
  if (!report) return notes;

  for (const text of report.meta.notes) {
    if (text.includes("alíquota")) notes.push({ text, action: { label: "Abrir regras de negócio" } });
    else if (text.toLowerCase().includes("taxa")) notes.push({ text, action: { label: "Cadastrar taxas", href: "/treasury/fees" } });
    else notes.push({ text });
  }

  for (const text of report.meta.payment?.notes ?? []) notes.push({ text });

  return notes;
}

/** Um resumo recolhido: o número de avisos à vista e o detalhe a um clique. Não ocupa a tela quando está tudo certo. */
export function SetupBanner({ notes, onOpenRules }: { notes: SetupNote[]; onOpenRules: () => void }) {
  if (notes.length === 0) return null;

  return (
    <details className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <TriangleAlert aria-hidden className="size-4" />
        Qualidade dos dados: {notes.length} {notes.length === 1 ? "aviso" : "avisos"}
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        {notes.map((note) => (
          <li key={note.text}>
            {note.text}{" "}
            {note.action?.href ? (
              <Link href={note.action.href} className="font-medium underline underline-offset-2">
                {note.action.label}
              </Link>
            ) : note.action ? (
              <button type="button" className="font-medium underline underline-offset-2" onClick={onOpenRules}>
                {note.action.label}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
