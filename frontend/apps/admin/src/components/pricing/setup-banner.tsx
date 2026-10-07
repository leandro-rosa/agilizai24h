import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import type { LatestPricingReport } from "@/lib/api/pricing";
import { incompleteSummary, isClassified } from "@/lib/pricing/operating";

const OLD_ENGINE_TEXT =
  "Este relatório foi calculado pelo motor anterior: a margem dele é a econômica, com custos fixos e deslocamento dentro do preço. Recalcule para ver a margem de contribuição, que é a que a meta de 35% orienta.";

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
    if (text.startsWith("Cálculo incompleto")) continue; // vai no alerta fixo (ValidationAlert), com os valores, e não num resumo recolhido
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

/**
 * Despesa relevante sem tratamento: o aviso é fixo (nunca recolhido) e traz o valor, o período e o escopo, porque enquanto ele existir nenhuma
 * recomendação da tela está validada. Leva às regras, onde cada conta recebe a sua classe.
 */
export function ValidationAlert({ latest, onOpenRules }: { latest: LatestPricingReport | null; onOpenRules: () => void }) {
  const operating = latest?.report?.meta.operating ?? null;
  // A report stored by the previous engine has no classification: its margin is the old economic one, with fixed costs inside the price.
  const text = latest?.report ? (operating !== null && !isClassified(operating) ? OLD_ENGINE_TEXT : incompleteSummary(operating)) : null;
  if (!text) return null;

  return (
    <div role="alert" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warning/40 bg-warning/12 p-3 text-sm text-warning">
      <p className="flex min-w-0 flex-1 items-start gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{text}</span>
      </p>
      <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={onOpenRules}>
        Classificar despesas
      </button>
    </div>
  );
}
