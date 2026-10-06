import { Store } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";

import { signedPct } from "@/lib/overview/compare";
import type { StoreContribution, StoreExplainers, StoreSummary } from "@/lib/overview/types";
import { Block, moneyRound, NoData, Unavailable } from "./shared";

function Explainers({ title, e, tone }: { title: string; e: StoreExplainers; tone: "up" | "down" }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      {e.stores.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma loja {tone === "up" ? "cresceu" : "recuou"}.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {e.stores.length} de {e.storeCount} {e.storeCount === 1 ? "loja explica" : "lojas explicam"} {Math.round(e.coveredShare * 100)}% ({moneyRound(e.totalCents)} no total)
          </p>
          {e.stores.map((s: StoreContribution & { share: number }) => (
            <div key={s.storeId} className="flex flex-col text-sm">
              <p className="flex justify-between gap-2">
                <span className="font-medium">{s.name}</span>
                <span className={`tabular ${tone === "up" ? "text-success" : "text-destructive"}`}>
                  {tone === "up" ? "+" : "−"}
                  {moneyRound(Math.abs(s.deltaCents))} · {Math.round(s.share * 100)}%
                </span>
              </p>
              <p className="tabular text-xs text-muted-foreground">
                {moneyRound(s.previousCents)} → {moneyRound(s.currentCents)}
                {s.deltaPct !== null ? ` (${signedPct(s.deltaPct, 0)})` : ""}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Resumo da rede: quantas lojas cresceram/recuaram e QUAIS explicaram a maior parte de cada movimento. */
export function StoresCard({ stores, unavailable }: { stores: StoreSummary | null; unavailable?: boolean }) {
  return (
    <Block title="Resumo da rede" icon={<Store className="size-4 text-primary" />} href="/finance/stores" linkLabel="Ver todas as lojas">
      {unavailable ? (
        <Unavailable what="DRE por loja" />
      ) : !stores ? (
        <NoData what="DRE por loja da competência ou do mês anterior" />
      ) : (
        <>
          <div className="flex items-center gap-6">
            <div className="relative size-24 shrink-0">
              <PieChart width={96} height={96}>
                <Pie
                  data={[
                    { name: "Cresceram", v: stores.up },
                    { name: "Recuaram", v: stores.down },
                    { name: "Estáveis", v: stores.stable },
                  ]}
                  dataKey="v"
                  innerRadius={30}
                  outerRadius={44}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {["var(--success)", "var(--destructive)", "var(--muted-foreground)"].map((c) => (
                    <Cell key={c} fill={c} />
                  ))}
                </Pie>
              </PieChart>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="tabular text-lg font-semibold">{stores.compared}</span>
                <span className="text-[11px] text-muted-foreground">lojas</span>
              </div>
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              <li><span className="mr-2 inline-block size-2 rounded-full bg-success" /><span className="tabular font-semibold">{stores.up}</span> cresceram</li>
              <li><span className="mr-2 inline-block size-2 rounded-full bg-destructive" /><span className="tabular font-semibold">{stores.down}</span> recuaram</li>
              <li><span className="mr-2 inline-block size-2 rounded-full bg-muted-foreground" /><span className="tabular font-semibold">{stores.stable}</span> estáveis</li>
            </ul>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Explainers title="Quem explicou o crescimento" e={stores.growthExplainers} tone="up" />
            <Explainers title="Quem explicou a queda" e={stores.declineExplainers} tone="down" />
          </div>
          <p className="text-xs text-muted-foreground">
            {stores.basis === "vendas"
              ? `Base: vendas de cada loja (sales-service), ${moneyRound(stores.storesRevenuePreviousCents)} → ${moneyRound(stores.storesRevenueCents)}. `
              : "Base: receita líquida por loja do DRE (faltam vendas de um dos meses; inclui receita de contrato). "}
            {stores.attention.length > 0 ? `${stores.attention.length} lojas com pontos de atenção (margem, perdas ou resultado) — ver análise completa.` : ""}
          </p>
        </>
      )}
    </Block>
  );
}
