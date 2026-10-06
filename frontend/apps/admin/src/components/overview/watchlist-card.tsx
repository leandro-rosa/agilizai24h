import { ArrowRight, Eye } from "lucide-react";
import Link from "next/link";

import type { WatchItem } from "@/lib/overview/types";
import { Block } from "./shared";
import { plainify } from "@/lib/overview/plain";

/**
 * "O que merece atenção no próximo mês": no máximo 5 itens, derivados só dos dados.
 * Cada item é uma observação com os fatos que a sustentam; nenhuma causa é afirmada.
 */
export function WatchlistCard({ items }: { items: WatchItem[] }) {
  return (
    <Block title="O que merece atenção no próximo mês" icon={<Eye className="size-4 text-primary" />}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Os dados deste mês não levantaram itens para acompanhar.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((w, n) => (
            <li key={w.id} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{n + 1}</span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold">{plainify(w.title)}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium">Observação:</span> {plainify(w.observation)}
                </p>
                <Link href={w.href} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Ver análise completa <ArrowRight className="size-3" />
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">Itens ordenados por relevância (impacto financeiro, peso, recorrência e lojas afetadas). São observações dos números, não conclusões de causa.</p>
    </Block>
  );
}
