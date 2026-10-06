import { Landmark } from "lucide-react";

import { date } from "@/lib/format";
import type { CashSummary } from "@/lib/overview/types";
import { Block, moneyRound, Stat, Unavailable } from "./shared";

export function CashCard({ cash }: { cash: CashSummary }) {
  const down = cash.cashDeltaCents !== null && cash.cashDeltaCents < 0;
  return (
    <Block title="Financeiro e caixa" icon={<Landmark className="size-4 text-primary" />} href="/finance/cash-flow" linkLabel="Ver fluxo de caixa">
      {cash.closing === null ? (
        <Unavailable what="fluxo de caixa da tesouraria" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Saldo inicial" value={moneyRound(cash.opening)} />
            <Stat label="Entradas" value={moneyRound(cash.inflow)} />
            <Stat label="Saídas" value={moneyRound(cash.outflow)} />
            <Stat label="Saldo final" value={moneyRound(cash.closing)} tone={down ? "critical" : "positive"} />
          </div>
          {cash.operatingPositiveCashFell && cash.cashDeltaCents !== null && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              Apesar do resultado operacional positivo, o caixa caiu {moneyRound(Math.abs(cash.cashDeltaCents))} no mês. Veja “Principais movimentos financeiros” para os maiores movimentos de saída.
            </p>
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="A receber vencido" value={cash.overdueCents === null ? "—" : moneyRound(cash.overdueCents)} tone={cash.overdueCents ? "critical" : undefined} hint={cash.agingReference ? `Posição em ${date(cash.agingReference)}` : undefined} />
        <Stat label="A vencer (todas as notas em aberto)" value={cash.notDueCents === null ? "—" : moneyRound(cash.notDueCents)} hint="Sem corte em 30 dias; posição atual" />
      </div>
      <p className="text-xs text-muted-foreground">Notas fiscais a emitir não existem como dado no sistema; só notas emitidas a receber.</p>
    </Block>
  );
}
