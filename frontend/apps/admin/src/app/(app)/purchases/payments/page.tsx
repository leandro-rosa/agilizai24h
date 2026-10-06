"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Agenda } from "@/components/purchases/payables/agenda";
import { EvolutionChart } from "@/components/purchases/payables/evolution-chart";
import { monthLabel, shiftMonth } from "@/components/purchases/payables/labels";
import { NO_FILTERS, OrdersTable, type TableFilters } from "@/components/purchases/payables/orders-table";
import { PayDialog } from "@/components/purchases/payables/pay-dialog";
import { Reconciliation } from "@/components/purchases/payables/reconciliation";
import { SummaryCards } from "@/components/purchases/payables/summary-cards";
import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHasPermission } from "@/lib/auth/use-permission";
import { useGetPayablesQuery } from "@/lib/api/purchases";

export default function PayablesPage() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const query = useGetPayablesQuery(month ? { month } : undefined);
  const data = query.data;
  const canWrite = useHasPermission("suppliers:write");
  const [filters, setFilters] = useState<TableFilters>(NO_FILTERS);
  const [paying, setPaying] = useState<{ ids: number[] } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const current = month ?? data?.month;

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
            {current && (
              <>
                <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(current, -1))}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-20 text-center text-sm font-medium" aria-label="Mês">
                  {monthLabel(current)}
                </span>
                <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(current, 1))}>
                  <ChevronRight className="size-4" />
                </Button>
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
            <SummaryCards summary={data.summary} />
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-sm">Evolução de pagamentos</CardTitle>
                </CardHeader>
                <CardContent>
                  <EvolutionChart series={data.series} />
                </CardContent>
              </Card>
              <Agenda payables={data} onSeeAll={() => showInTable({ state: "upcoming" })} />
            </div>
            <div ref={tableRef} className="min-w-0 scroll-mt-4">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-sm">Contas a pagar — {monthLabel(data.month)} e em aberto</CardTitle>
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
