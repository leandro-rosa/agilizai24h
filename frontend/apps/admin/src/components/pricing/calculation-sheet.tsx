import { History } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PricingReport, PricingRunView } from "@/lib/api/pricing";
import { date, period as formatPeriod } from "@/lib/format";
import { marginMetric } from "@/lib/pricing/metric";

/**
 * A ficha do cálculo que está na tela: a métrica com o nome e a definição com que foi calculada, a versão do motor e das regras, o período e as bases.
 * Um cálculo do motor anterior mantém a SUA métrica (a margem econômica) e nunca é renomeado; recalcular gera uma versão nova e o anterior continua na
 * lista, legível como foi calculado. Quando se olha um cálculo antigo, a tela diz isso e não oferece aplicar preço nem simular sobre ele.
 */
export function CalculationSheet({
  report,
  run,
  history,
  viewingOlder,
  onView,
}: {
  report: PricingReport;
  run: PricingRunView | null;
  history: PricingRunView[];
  /** O cálculo em tela não é o mais recente. */
  viewingOlder: boolean;
  /** `null` volta ao mais recente. */
  onView: (id: string | null) => void;
}) {
  const metric = marginMetric(report.meta.engineVersion);
  const previousEngine = metric.key === "economic";
  const months = report.meta.months.length > 0 ? `${formatPeriod(report.meta.months[0])} a ${formatPeriod(report.meta.months[report.meta.months.length - 1])}` : "—";

  return (
    <section aria-label="Ficha do cálculo" className={`flex flex-col gap-2 rounded-lg border p-3 text-xs ${previousEngine || viewingOlder ? "border-warning/40 bg-warning/12" : "text-muted-foreground"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <History aria-hidden className="size-4" />
        <span className="font-medium text-foreground">Ficha do cálculo</span>
        {previousEngine && <StatusBadge tone="attention">Cálculo anterior: {metric.name.toLowerCase()}</StatusBadge>}
        {viewingOlder && <StatusBadge tone="neutral">Cálculo mais antigo, só leitura</StatusBadge>}
        {history.length > 1 && (
          <Select value={run?.id ?? ""} onValueChange={(id) => onView(id === history[0]?.id ? null : id)}>
            <SelectTrigger className="ml-auto h-8 w-72" aria-label="Cálculos anteriores">
              <SelectValue placeholder="Cálculos deste período" />
            </SelectTrigger>
            <SelectContent>
              {history.map((item, index) => (
                <SelectItem key={item.id} value={item.id}>
                  {date(item.computedAt)} · motor {item.engineVersion} · regras v{item.parameterVersion}
                  {index === 0 ? " (mais recente)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="inline">Métrica: </dt>
          <dd className="inline">
            <strong>{metric.name}</strong>. {metric.definition}
          </dd>
        </div>
        <div>
          <dt className="inline">Motor e regras: </dt>
          <dd className="inline">
            {report.meta.engineVersion} · regras v{report.meta.parameterVersion}
            {run?.computedAt ? ` · calculado em ${date(run.computedAt)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="inline">Período e bases: </dt>
          <dd className="inline">
            {months}; custo, preço e taxas vigentes em {date(report.meta.asOf)}; {report.meta.storeId === null ? "rede inteira" : `loja ${report.meta.storeId}`}
          </dd>
        </div>
      </dl>
      {previousEngine && (
        <p>
          Este cálculo foi feito pelo motor anterior, com custos fixos e deslocamento dentro do preço. Os valores abaixo são os daquele cálculo e não foram alterados; recalcule para gerar uma versão nova com a margem de contribuição, e esta continua disponível na lista.
        </p>
      )}
    </section>
  );
}
