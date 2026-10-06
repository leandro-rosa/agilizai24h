import { Store } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";

import type { StoreSummary } from "@/lib/overview/types";
import { Block, moneyRound, Unavailable } from "./shared";

export function StoresCard({ stores }: { stores: StoreSummary | null }) {
  return (
    <Block title="Resumo da rede" icon={<Store className="size-4 text-primary" />} href="/finance/stores" linkLabel="Ver todas as lojas">
      {!stores ? (
        <Unavailable what="DRE por loja" />
      ) : (
        <>
          <div className="flex items-center gap-6">
            <div className="relative size-28 shrink-0">
              <PieChart width={112} height={112}>
                <Pie
                  data={[
                    { name: "Cresceram", v: stores.up, fill: "var(--success)" },
                    { name: "Recuaram", v: stores.down, fill: "var(--destructive)" },
                    { name: "Estáveis", v: stores.stable, fill: "var(--muted-foreground)" },
                  ]}
                  dataKey="v"
                  innerRadius={36}
                  outerRadius={52}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {["var(--success)", "var(--destructive)", "var(--muted-foreground)"].map((c) => (
                    <Cell key={c} fill={c} />
                  ))}
                </Pie>
              </PieChart>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="tabular text-xl font-semibold">{stores.compared}</span>
                <span className="text-[11px] text-muted-foreground">lojas</span>
              </div>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              <li><span className="mr-2 inline-block size-2 rounded-full bg-success" /><span className="tabular font-semibold">{stores.up}</span> cresceram</li>
              <li><span className="mr-2 inline-block size-2 rounded-full bg-destructive" /><span className="tabular font-semibold">{stores.down}</span> recuaram</li>
              <li><span className="mr-2 inline-block size-2 rounded-full bg-muted-foreground" /><span className="tabular font-semibold">{stores.stable}</span> estáveis</li>
              {stores.activeCount !== null && <li className="text-xs text-muted-foreground">{stores.activeCount} lojas ativas no cadastro</li>}
            </ul>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Principais contribuições para o crescimento</p>
              {stores.topGrowth.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma loja cresceu.</p> : stores.topGrowth.map((s) => (
                <p key={s.storeId} className="flex justify-between gap-2 text-sm">
                  <span>{s.name}</span>
                  <span className="tabular text-success">+{moneyRound(s.deltaCents)}{s.deltaPct !== null ? ` · +${(s.deltaPct * 100).toFixed(0)}%` : ""}</span>
                </p>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Pontos de atenção</p>
              {stores.attention.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum ponto material.</p> : stores.attention.map((s) => (
                <p key={s.storeId} className="text-sm"><span className="font-medium">{s.name}</span> <span className="text-muted-foreground">— {s.reasons.join("; ")}</span></p>
              ))}
            </div>
          </div>
        </>
      )}
    </Block>
  );
}
