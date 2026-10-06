import { Wallet } from "lucide-react";

import { signedPct } from "@/lib/overview/compare";
import { period as fmtPeriod } from "@/lib/format";
import type { CashUseLine, CashUses } from "@/lib/overview/types";
import { Block, moneyRound, Unavailable } from "./shared";

function Line({ l, previousPeriod }: { l: CashUseLine; previousPeriod: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <span className="font-medium">{l.label}</span>
      <span className="tabular text-right">
        {moneyRound(l.currentCents)}{" "}
        <span className="text-xs text-muted-foreground">
          {l.deltaPct === null ? "sem comparação" : `${signedPct(l.deltaPct)} vs. ${fmtPeriod(previousPeriod)}`}
          {l.avg3Cents !== null ? ` · média 3m ${moneyRound(l.avg3Cents)}` : ""}
        </span>
      </span>
    </li>
  );
}

export function UsesCard({ uses, previousPeriod }: { uses: CashUses | null; previousPeriod: string }) {
  return (
    <Block title="Principais movimentos financeiros" icon={<Wallet className="size-4 text-primary" />} href="/treasury" linkLabel="Ver tesouraria">
      {!uses ? (
        <Unavailable what="tesouraria" />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {uses.stock && <Line l={uses.stock} previousPeriod={previousPeriod} />}
            {uses.capex && <Line l={uses.capex} previousPeriod={previousPeriod} />}
            {uses.expenses.map((e) => <Line key={e.key} l={e} previousPeriod={previousPeriod} />)}
          </ul>
          {uses.stockVsRevenue && uses.stockVsRevenue.stockDeltaPct !== null && uses.stockVsRevenue.revenueDeltaPct !== null && (
            <p className="text-sm text-muted-foreground">
              Compras de estoque {signedPct(uses.stockVsRevenue.stockDeltaPct)} enquanto o faturamento variou {signedPct(uses.stockVsRevenue.revenueDeltaPct)} (fato; sem conclusão de eficiência).
            </p>
          )}
          <p className="text-xs text-muted-foreground">Mostra só o que variou de forma material. Compras de estoque (caixa, tesouraria) e CMV (custo da mercadoria vendida, finance) são medidas diferentes e não se somam. CAPEX (capex-service) fica separado de despesa operacional.</p>
        </>
      )}
    </Block>
  );
}
