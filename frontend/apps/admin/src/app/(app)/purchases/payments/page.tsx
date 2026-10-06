"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { DateRangePicker, type DayRange as PickerRange } from "@/components/date-range-picker";
import { PageHeader } from "@/components/page-header";
import { Agenda } from "@/components/purchases/payables/agenda";
import { EvolutionChart } from "@/components/purchases/payables/evolution-chart";
import { shiftMonth as shiftMonthBy } from "@/components/purchases/payables/labels";
import { NO_FILTERS, OrdersTable, type TableFilters } from "@/components/purchases/payables/orders-table";
import { PayDialog } from "@/components/purchases/payables/pay-dialog";
import { Reconciliation } from "@/components/purchases/payables/reconciliation";
import { SummaryCards } from "@/components/purchases/payables/summary-cards";
import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHasPermission } from "@/lib/auth/use-permission";
import { useGetPayablesQuery } from "@/lib/api/purchases";
import { addDays, dayCount, formatDay, isWholeMonths, shiftRange, type DayRange } from "@/lib/supplier-analysis/day-range";

const FAR_FUTURE = "9999-12-31";
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function PayablesPage() {
  // Um mês (as setas andam de mês em mês) ou os dias escolhidos no calendário ("Hoje", "Ontem" ou um intervalo).
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [days, setDays] = useState<DayRange | null>(null);
  const [draft, setDraft] = useState<PickerRange | null>(null);
  const query = useGetPayablesQuery(days ? { from: days.from, to: days.to } : month ? { month } : undefined);
  const data = query.data;
  const period: DayRange | null = days ?? data?.period ?? null;
  const periodLabel = days ? "período" : "mês";
  const canWrite = useHasPermission("suppliers:write");
  const [filters, setFilters] = useState<TableFilters>(NO_FILTERS);
  const [paying, setPaying] = useState<{ ids: number[] } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  /** Escolher dias é, em geral, querer ver o que foi pago neles: a tabela já vem em "Pago" (dá para trocar). */
  function pickDays(range: DayRange) {
    setDays(range);
    setDraft(null);
    setFilters((current) => ({ ...current, state: "paid" }));
  }

  /** O calendário escolhe a ponta inicial antes da final: o rascunho mostra o clique sem consultar a API. */
  function onPick(picked: PickerRange) {
    if (picked.from && picked.to) pickDays({ from: picked.from, to: picked.to });
    else if (picked.from) setDraft(picked);
    else setDraft(null);
  }

  function shift(direction: -1 | 1) {
    if (!period) return;
    if (!days && !isWholeMonths(period)) return;
    if (!days) return setMonth(shiftMonthBy(period.from.slice(0, 7), direction));
    const next = shiftRange(days, direction, FAR_FUTURE);
    if (next) pickDays(next);
  }

  const showInTable = (patch: Partial<TableFilters>) => {
    setFilters({ ...NO_FILTERS, ...patch });
    tableRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="A pagar"
        description="Contas a pagar, notas e pedidos num só lugar. O painel só registra o que foi pago; não paga. Consignado fica no Acerto semanal."
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {period && (
              <>
                <Button variant="outline" size="icon" aria-label="Período anterior" onClick={() => shift(-1)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <DateRangePicker value={draft ?? period} onChange={onPick} />
                <Button variant="outline" size="icon" aria-label="Próximo período" onClick={() => shift(1)}>
                  <ChevronRight className="size-4" />
                </Button>
                <Button variant={days && days.from === days.to && days.to === todayIso() ? "secondary" : "outline"} size="sm" onClick={() => pickDays({ from: todayIso(), to: todayIso() })}>
                  Hoje
                </Button>
                <Button variant="outline" size="sm" onClick={() => pickDays({ from: addDays(todayIso(), -1), to: addDays(todayIso(), -1) })}>
                  Ontem
                </Button>
                {days && (
                  <Button variant="ghost" size="sm" onClick={() => { setDays(null); setDraft(null); }} aria-label="Voltar ao mês">
                    Mês
                  </Button>
                )}
              </>
            )}
            {canWrite && (
              <Button onClick={() => setPaying({ ids: [] })}>
                <Plus className="size-4" /> Lançar pagamento
              </Button>
            )}
          </div>
        }
      />
      <RequestState isLoading={query.isLoading} error={query.error} onRetry={query.refetch}>
        {data && (
          <>
            <SummaryCards summary={data.summary} periodLabel={periodLabel} />
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-sm">Evolução de pagamentos</CardTitle>
                </CardHeader>
                <CardContent>
                  <EvolutionChart series={data.series} />
                </CardContent>
              </Card>
              <Agenda payables={data} periodLabel={periodLabel} onSeeAll={() => showInTable({ state: "upcoming" })} />
            </div>
            <div ref={tableRef} className="min-w-0 scroll-mt-4">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-sm">Contas a pagar — {dayCount(data.period) === 1 ? formatDay(data.period.from) : `${formatDay(data.period.from)} a ${formatDay(data.period.to)}`}, mais o que está em aberto</CardTitle>
                </CardHeader>
                <CardContent>
                  <OrdersTable orders={data.orders} filters={filters} onFilters={setFilters} onPay={(id) => setPaying({ ids: [id] })} />
                </CardContent>
              </Card>
            </div>
            <Reconciliation data={data.reconciliation} onShow={(ids, label) => showInTable({ ids, idsLabel: label })} />
            {paying && <PayDialog candidates={data.orders} preselected={paying.ids} open onOpenChange={(open) => !open && setPaying(null)} />}
          </>
        )}
      </RequestState>
    </div>
  );
}
