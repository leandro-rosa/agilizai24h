import { HardHat } from "lucide-react";
import Link from "next/link";

import { signedPct } from "@/lib/overview/compare";
import { period as fmtPeriod } from "@/lib/format";
import { ITEM_CATEGORY_LABELS, CONTRIBUTION_KIND_LABELS, type ItemCategory } from "@/lib/api/capex";
import type { CapexSummary, InvestorsSummary } from "@/lib/overview/types";
import { Block, moneyRound, Unavailable } from "./shared";

export function CapexCard({ capex, investors, previousPeriod }: { capex: CapexSummary | null; investors: InvestorsSummary | null; previousPeriod: string }) {
  return (
    <Block title="CAPEX e investidores" icon={<HardHat className="size-4 text-primary" />} href="/capex" linkLabel="Ver CAPEX por loja">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-muted-foreground">CAPEX do mês</p>
        {!capex?.current ? (
          <Unavailable what="itens de CAPEX" />
        ) : (
          <>
            <p className="tabular text-xl font-semibold">
              {moneyRound(capex.current.totalCents)}{" "}
              <span className="text-sm font-normal text-muted-foreground">{capex.deltaPct === null ? "sem comparação" : `${signedPct(capex.deltaPct)} vs. ${fmtPeriod(previousPeriod)}`}</span>
            </p>
            {capex.top.map((t) => (
              <p key={t.category} className="flex justify-between text-sm"><span>{ITEM_CATEGORY_LABELS[t.category as ItemCategory] ?? t.category}</span><span className="tabular">{moneyRound(t.cents)}</span></p>
            ))}
            {capex.current.unassignedCents > 0 && <p className="text-xs text-muted-foreground">{moneyRound(capex.current.unassignedCents)} sem loja atribuída.</p>}
            {capex.current.totalCents === 0 && <p className="text-sm text-muted-foreground">Nenhum item de CAPEX datado neste mês.</p>}
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5 border-t pt-4">
        <p className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>Aportes de investidores no mês</span>
          <Link href="/capex/investors" className="text-primary hover:underline">Ver investidores →</Link>
        </p>
        {!investors?.current ? (
          <Unavailable what="aportes" />
        ) : (
          <>
            <p className="tabular text-xl font-semibold">
              {moneyRound(investors.current.totalCents)}{" "}
              <span className="text-sm font-normal text-muted-foreground">{investors.deltaPct === null ? "sem comparação" : `${signedPct(investors.deltaPct)} vs. ${fmtPeriod(previousPeriod)}`}</span>
            </p>
            {investors.current.byKind.map((k) => (
              <p key={k.kind} className="flex justify-between text-sm"><span>{CONTRIBUTION_KIND_LABELS[k.kind] ?? k.kind}</span><span className="tabular">{moneyRound(k.cents)}</span></p>
            ))}
          </>
        )}
        <p className="text-xs text-muted-foreground">Movimentação de investidor não é receita operacional. O sistema só registra aportes; devolução, distribuição e remuneração não existem como dado.</p>
      </div>
    </Block>
  );
}
