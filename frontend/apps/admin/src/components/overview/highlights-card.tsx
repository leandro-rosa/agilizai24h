import { ArrowRight, Flame, Star, TrendingUp } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Highlight, Highlights } from "@/lib/overview/types";

function Item({ icon, label, h, empty }: { icon: React.ReactNode; label: string; h: Highlight | null; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {h ? (
          <>
            <p className="text-sm font-semibold leading-snug">{h.title}</p>
            <p className="text-sm text-muted-foreground">{h.detail}</p>
            <Link href={h.href} className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Ver análise completa <ArrowRight className="size-3" />
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Destaques do mês: produto destaque, maior crescimento e maior ponto de atenção. */
export function HighlightsCard({ highlights }: { highlights: Highlights }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Item icon={<Star className="size-3.5 text-primary" />} label="Produto destaque" h={highlights.product} empty="Sem vendas de produtos para destacar neste mês." />
      <Item icon={<TrendingUp className="size-3.5 text-success" />} label="Maior crescimento" h={highlights.growth} empty="Nenhuma loja cresceu nas vendas neste mês." />
      <Item icon={<Flame className="size-3.5 text-destructive" />} label="Maior ponto de atenção" h={highlights.attention} empty="Os dados não levantaram nenhum ponto de atenção relevante." />
    </div>
  );
}
