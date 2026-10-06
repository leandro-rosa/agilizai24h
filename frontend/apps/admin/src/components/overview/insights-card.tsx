import { Sparkles } from "lucide-react";

import type { Insight } from "@/lib/overview/types";
import { Block } from "./shared";

const dot: Record<Insight["tone"], string> = { positive: "bg-success", negative: "bg-destructive", neutral: "bg-muted-foreground" };

export function InsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <Block title="O que aconteceu este mês?" icon={<Sparkles className="size-4 text-primary" />}>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma variação material neste mês com os dados disponíveis.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          {insights.map((i, n) => (
            <li key={i.id} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{n + 1}</span>
              <div className="flex flex-col gap-0.5">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`size-2 shrink-0 rounded-full ${dot[i.tone]}`} aria-hidden />
                  {i.title}
                </p>
                <p className="text-sm text-muted-foreground">{i.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}
