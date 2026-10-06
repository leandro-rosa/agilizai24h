import { Truck } from "lucide-react";

import { reasonLabel } from "@/lib/removal-reasons";
import type { LossSummary } from "@/lib/overview/types";
import { Block, moneyRound, pctText, Stat, Unavailable } from "./shared";

export function LossCard({ loss }: { loss: LossSummary | null }) {
  return (
    <Block title="Abastecimento e perdas" icon={<Truck className="size-4 text-primary" />} href="/supply">
      {!loss ? (
        <Unavailable what="nenhuma loja reconciliada no mês" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total abastecido (custo)" value={moneyRound(loss.restockedCents)} />
            <Stat label="Perdas (R$)" value={moneyRound(loss.lossCents)} />
            <Stat label="Perda ÷ receita líquida" value={pctText(loss.lossToRevenue)} />
            <Stat label="Perda ÷ custo abastecido" value={pctText(loss.lossToSupplied)} />
          </div>
          {loss.incompleteStores > 0 && (
            <p className="text-xs text-warning">{loss.incompleteStores} loja(s) com reconciliação incompleta (SKU sem custo ou saldo inconsistente) — valores podem estar subestimados.</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Principais motivos de perda</p>
              {loss.byReason.length === 0 ? <p className="text-sm text-muted-foreground">Sem perdas no mês.</p> : loss.byReason.map((r) => (
                <div key={r.reason} className="flex items-center gap-2 text-sm">
                  <span className="w-32 shrink-0 truncate">{reasonLabel(r.reason)}</span>
                  <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.round((r.share ?? 0) * 100)}%` }} /></div>
                  <span className="tabular w-10 text-right text-xs">{pctText(r.share, 0)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Produtos com maior perda (R$)</p>
              {loss.topSkus.map((s, n) => (
                <p key={s.sku} className="flex justify-between gap-2 text-sm"><span className="truncate"><span className="mr-2 text-muted-foreground">{n + 1}</span>{s.name}</span><span className="tabular">{moneyRound(s.valueCents)} · {pctText(s.share, 0)}</span></p>
              ))}
              {loss.top3Share !== null && <p className="text-xs text-muted-foreground">Os 3 maiores SKUs somam {pctText(loss.top3Share, 0)} da perda do mês.</p>}
            </div>
          </div>
        </>
      )}
    </Block>
  );
}
