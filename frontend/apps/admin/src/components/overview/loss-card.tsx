import { Truck } from "lucide-react";

import { signedPct } from "@/lib/overview/compare";
import { period as fmtPeriod } from "@/lib/format";
import { reasonLabel } from "@/lib/removal-reasons";
import type { LossChange, LossSummary } from "@/lib/overview/types";
import { Block, moneyRound, NoData, pctText, Stat } from "./shared";

function ChangeList({ title, rows, reason }: { title: string; rows: LossChange[]; reason?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem variação relevante.</p>
      ) : (
        rows.map((c) => (
          <div key={c.label} className="flex flex-col text-sm">
            <p className="flex justify-between gap-2">
              <span className="truncate font-medium">{reason ? reasonLabel(c.label) : c.label}</span>
              <span className={`tabular ${c.deltaCents > 0 ? "text-destructive" : "text-success"}`}>
                {c.deltaCents > 0 ? "+" : "−"}
                {moneyRound(Math.abs(c.deltaCents))}
              </span>
            </p>
            <p className="tabular text-xs text-muted-foreground">{moneyRound(c.previousCents)} → {moneyRound(c.currentCents)}</p>
          </div>
        ))
      )}
    </div>
  );
}

/** KPIs de perda + o que MUDOU nela no mês (motivos e produtos que mais se moveram). */
export function LossCard({ loss, previousPeriod }: { loss: LossSummary | null; previousPeriod: string }) {
  const ch = loss?.changes ?? null;
  return (
    <Block title="Abastecimento e produtos perdidos" icon={<Truck className="size-4 text-primary" />} href="/supply" linkLabel="Ver análise completa">
      {!loss ? (
        <NoData what="nenhuma loja com contagem de estoque no mês" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total abastecido (custo)" value={moneyRound(loss.restockedCents)} />
            <Stat label="Perdas (R$)" value={moneyRound(loss.lossCents)} />
            <Stat label="Perdas em % do faturamento" value={pctText(loss.lossToRevenue)} />
            <Stat label="Perdas em % do abastecido" value={pctText(loss.lossToSupplied)} />
          </div>
          {loss.incompleteStores > 0 && (
            <p className="text-xs text-warning">{loss.incompleteStores} loja(s) com contagem de estoque com falhas (produto sem custo ou saldo que não bate) — as perdas podem estar maiores do que o mostrado.</p>
          )}
          <div className="flex flex-col gap-3 border-t pt-3">
            <p className="text-sm font-semibold">O que mudou nas perdas</p>
            {!ch ? (
              <p className="text-sm text-muted-foreground">Sem perdas de {fmtPeriod(previousPeriod)} para comparar.</p>
            ) : (
              <>
                <p className="tabular text-sm">
                  {moneyRound(ch.totalPreviousCents)} → {moneyRound(ch.totalCurrentCents)}
                  {ch.totalPreviousCents > 0 ? ` (${signedPct((ch.totalCurrentCents - ch.totalPreviousCents) / ch.totalPreviousCents, 0)})` : ""}
                  {ch.skusExplainingShare ? (
                    <span className="text-muted-foreground"> · {ch.skusExplainingShare.count} {ch.skusExplainingShare.count === 1 ? "produto explica" : "produtos explicam"} {Math.round(ch.skusExplainingShare.share * 100)}% da variação</span>
                  ) : null}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ChangeList title="Motivos que mais mudaram" rows={ch.byReason.slice(0, 3)} reason />
                  <ChangeList title="Produtos que mais mudaram" rows={ch.bySku.slice(0, 3)} />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Block>
  );
}
