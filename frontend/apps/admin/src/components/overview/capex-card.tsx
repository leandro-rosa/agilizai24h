import { HardHat } from "lucide-react";
import Link from "next/link";

import { signedPct } from "@/lib/overview/compare";
import { period as fmtPeriod } from "@/lib/format";
import { CONTRIBUTION_KIND_LABELS } from "@/lib/api/capex";
import type { CapexSummary, InvestorsSummary } from "@/lib/overview/types";
import { Block, moneyRound, NoData } from "./shared";

export function CapexCard({ capex, investors, previousPeriod }: { capex: CapexSummary | null; investors: InvestorsSummary | null; previousPeriod: string }) {
  return (
    <Block title="Investimentos e aportes dos sócios" icon={<HardHat className="size-4 text-primary" />} href="/capex" linkLabel="Ver investimento por loja">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-muted-foreground">Investimento do mês — dinheiro gasto em equipamentos e novas lojas (como no Fluxo de caixa)</p>
        {!capex?.investment ? (
          <NoData what="sem lançamentos da tesouraria no mês" />
        ) : (
          <>
            <p className="tabular text-xl font-semibold">
              {moneyRound(capex.investment.totalCents)}{" "}
              <span className="text-sm font-normal text-muted-foreground">{capex.investment.deltaPct === null ? "sem comparação" : `${signedPct(capex.investment.deltaPct)} vs. ${fmtPeriod(previousPeriod)}`}</span>
            </p>
            {capex.investment.top.map((t) => (
              <p key={t.category} className="flex justify-between text-sm"><span>{t.category}</span><span className="tabular">{moneyRound(t.cents)}</span></p>
            ))}
            {capex.investment.partnerCardCents > 0 && (
              <p className="text-xs text-muted-foreground">Dos quais {moneyRound(capex.investment.partnerCardCents)} pagos no cartão de sócios (Bárbara e Josias).</p>
            )}
            {capex.investment.totalCents === 0 && <p className="text-sm text-muted-foreground">Nenhuma saída de investimento neste mês.</p>}
          </>
        )}
        <p className="pt-1 text-xs text-muted-foreground">
          Itens de investimento com loja definida:{" "}
          {!capex?.current ? "indisponível" : capex.current.totalCents === 0 ? "nenhum item datado neste mês" : `${moneyRound(capex.current.totalCents)}${capex.current.unassignedCents > 0 ? ` (${moneyRound(capex.current.unassignedCents)} sem loja)` : ""}`}.
          {" "}Esse cadastro por loja é separado da classificação do Fluxo de caixa e pode ficar atrás dela.
        </p>
      </div>
      <div className="flex flex-col gap-1.5 border-t pt-4">
        <p className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>Aportes de investidores no mês</span>
          <Link href="/capex/investors" className="text-primary hover:underline">Ver investidores →</Link>
        </p>
        {!investors?.current ? (
          <NoData what="nenhum aporte registrado no mês" />
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
