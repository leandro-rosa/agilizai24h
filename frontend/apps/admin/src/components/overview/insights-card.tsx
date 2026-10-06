import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

import type { Insight } from "@/lib/overview/types";
import { Block } from "./shared";
import { plainify } from "@/lib/overview/plain";

const dot: Record<Insight["tone"], string> = { positive: "bg-success", negative: "bg-destructive", neutral: "bg-muted-foreground" };

/** O que mudou: até 6 achados ordenados por relevância (não por % de variação), cada um com a base. */
export function InsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <Block title="O que mudou neste mês" icon={<Sparkles className="size-4 text-primary" />}>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma variação material neste mês com os dados disponíveis.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          {insights.map((i, n) => (
            <li key={i.id} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{n + 1}</span>
              <div className="flex flex-col gap-0.5">
                <p className="flex items-start gap-2 text-sm font-semibold">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot[i.tone]}`} aria-hidden />
                  {plainify(i.title)}
                </p>
                <p className="text-sm text-muted-foreground">{plainify(i.detail)}</p>
                {i.href && (
                  <Link href={i.href} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Ver análise completa <ArrowRight className="size-3" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">Ordem por relevância: impacto em R$, representatividade, recorrência e lojas afetadas — não pelo tamanho do %.</p>
    </Block>
  );
}
