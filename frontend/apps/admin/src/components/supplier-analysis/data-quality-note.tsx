import { AlertTriangle } from "lucide-react";

import type { AnalysisMeta } from "@/lib/api/supplier-analysis";
import { formatMonth } from "@/lib/supplier-analysis/format";

/** Avisa onde o dado de origem é sabidamente incompleto, para nenhuma cifra parecer mais inteira do que é. */
export function DataQualityNote({ meta }: { meta: AnalysisMeta }) {
  const gaps = meta.dataQuality.monthsWithGaps;
  const purchaseBase = meta.dataQuality.purchaseBaseFrom;

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="data-quality-note">
      <p>
        {purchaseBase
          ? `Base de compras: a partir de ${formatMonth(purchaseBase)}. Antes disso, apenas abastecimento, vendas e perdas.`
          : "Base de compras: ainda não registrada (prevista a partir de out/2026). Valores de compra aparecem como “Sem histórico de compras”."}
      </p>
      {meta.daily && (
        <p data-testid="daily-note">
          Intervalo por dia: abastecimento vem das visitas (exato) e venda dos recibos com data.
          {meta.daily.lossEstimated ? " A perda do dia é uma estimativa (≈): o total de perda do mês rateado pelas remoções de cada visita." : ""}
          {meta.daily.salesDetailMissingMonths.length > 0
            ? ` Sem recibos com data em ${meta.daily.salesDetailMissingMonths.map(formatMonth).join(", ")}: a venda desses dias aparece como “Dado não importado”, não como zero.`
            : ""}
        </p>
      )}
      {gaps.length > 0 && (
        <p className="flex items-start gap-1">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            Dados incompletos na janela:{" "}
            {gaps
              .map((gap) => {
                const parts = [
                  gap.storesMissingSales > 0 ? `${gap.storesMissingSales} sem vendas` : null,
                  gap.storesMissingSupply > 0 ? `${gap.storesMissingSupply} sem abastecimento` : null,
                ].filter(Boolean);
                return `${formatMonth(gap.month)} (lojas ${parts.join(", ")})`;
              })
              .join("; ")}
            . Cifras afetadas aparecem com “~”.
          </span>
        </p>
      )}
    </div>
  );
}
