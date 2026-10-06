import { Wallet } from "lucide-react";

import { signedPct } from "@/lib/overview/compare";
import { baseText } from "@/lib/overview/ranking";
import { period as fmtPeriod } from "@/lib/format";
import type { CashUseLine, CashUses } from "@/lib/overview/types";
import { Block, moneyRound, NoData, pctText, Unavailable } from "./shared";

const REASON: Record<CashUseLine["reasons"][number], string> = { variacao: "variou", peso: "maior saída" };

function Line({ l, previousPeriod }: { l: CashUseLine; previousPeriod: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <span>
        <span className="font-medium">{l.label}</span>{" "}
        <span className="text-[11px] text-muted-foreground">{l.reasons.map((r) => REASON[r]).join(" · ")}</span>
      </span>
      <span className="tabular text-right">
        {moneyRound(l.currentCents)}
        <span className="block text-xs text-muted-foreground">
          {l.previousCents === null
            ? "sem base no mês anterior"
            : `${baseText(l.previousCents, l.currentCents, (n) => moneyRound(n), "")}${l.deltaPct !== null && l.previousCents > 0 ? ` (${signedPct(l.deltaPct, 0)})` : ""} vs. ${fmtPeriod(previousPeriod)}`}
          {l.shareOfOutflow !== null ? ` · ${pctText(l.shareOfOutflow, 0)} das saídas` : ""}
        </span>
      </span>
    </li>
  );
}

/** Movimentos selecionados pelos dados (variação ou peso), de qualquer categoria. */
export function UsesCard({ uses, previousPeriod, unavailable }: { uses: CashUses | null; previousPeriod: string; unavailable?: boolean }) {
  return (
    <Block title="Principais movimentos financeiros" icon={<Wallet className="size-4 text-primary" />} href="/treasury" linkLabel="Ver tesouraria">
      {unavailable ? (
        <Unavailable what="tesouraria" />
      ) : !uses ? (
        <NoData what="sem lançamentos da tesouraria no mês" />
      ) : uses.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum movimento com variação ou peso relevante neste mês.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">{uses.lines.map((l) => <Line key={l.key} l={l} previousPeriod={previousPeriod} />)}</ul>
          {uses.stockVsRevenue && uses.stockVsRevenue.stockDeltaPct !== null && uses.stockVsRevenue.revenueDeltaPct !== null && (
            <p className="text-sm text-muted-foreground">
              Observação: compras de estoque {signedPct(uses.stockVsRevenue.stockDeltaPct)} enquanto o faturamento variou {signedPct(uses.stockVsRevenue.revenueDeltaPct)}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">Selecionados por variação material ou peso nas saídas ({moneyRound(uses.totalOutflowCents)} no mês) — sem categoria fixa. Compras de estoque (caixa) e CMV (finance) não se somam.</p>
        </>
      )}
    </Block>
  );
}
