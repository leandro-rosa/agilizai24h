"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetCashFlowQuery, useGetPnlQuery } from "@/lib/api/accounting";
import { useGetAgingQuery } from "@/lib/api/billing";
import { useGetOverviewQuery } from "@/lib/api/overview";
import { count, currentPeriod, money, period as fmtPeriod } from "@/lib/format";

/**
 * A visão geral agora tem KPIs de rede que existem de verdade — antes só
 * havia contagem de lojas e produtos, porque nada era agregável.
 *
 * A honestidade da tela anterior fica: o que o backend não souber responder
 * mostra "Indisponível", nunca um zero. Um zero fabricado numa visão geral é
 * pior que um vazio — ele parece um número.
 */
export default function DashboardPage() {
  const period = currentPeriod();

  const { data: overview, isLoading, error, refetch } = useGetOverviewQuery();
  const { data: pnl, isError: pnlFailed } = useGetPnlQuery({ period });
  const { data: cashFlow, isError: cashFailed } = useGetCashFlowQuery();
  const { data: aging, isError: agingFailed } = useGetAgingQuery();

  const storeCounts = useMemo(() => {
    if (!overview?.stores.available) return null;
    const byStatus = { active: 0, maintenance: 0, inactive: 0 };
    for (const store of overview.stores.data) byStatus[store.status] += 1;
    return byStatus;
  }, [overview]);

  const productCount = overview?.products.available ? overview.products.data.length : null;

  // O último período lançado, não o corrente: o fluxo de caixa é fechado com
  // atraso, e mostrar o mês em curso daria um saldo sempre zerado.
  const latestCash = cashFlow && cashFlow.length > 0 ? cashFlow[cashFlow.length - 1] : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Visão geral" description={`Resumo da rede — competência ${fmtPeriod(period)}.`} />

      <RequestState isLoading={isLoading} error={error} onRetry={refetch}>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Financeiro</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Receita líquida do mês"
              value={pnl ? money(pnl.totals.net_revenue_cents) : null}
              unavailable={pnlFailed}
              source="DRE"
            />
            <Kpi
              label="Margem operacional"
              value={pnl ? money(pnl.totals.operating_profit_cents) : null}
              tone={pnl && pnl.totals.operating_profit_cents < 0 ? "critical" : "positive"}
              unavailable={pnlFailed}
              source="DRE"
            />
            <Kpi
              label="Saldo em caixa"
              value={latestCash ? money(latestCash.closing_balance_cents) : null}
              hint={latestCash ? `Fechamento de ${fmtPeriod(latestCash.period)}` : undefined}
              unavailable={cashFailed}
              source="Fluxo de caixa"
            />
            <Kpi
              label="A receber vencido"
              value={aging ? money(aging.overdue_amount_cents) : null}
              tone={aging && aging.overdue_amount_cents > 0 ? "critical" : undefined}
              unavailable={agingFailed}
              source="Notas fiscais"
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Rede</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Lojas ativas" value={storeCounts ? count(storeCounts.active) : null} unavailable={!overview?.stores.available} />
            <Kpi
              label="Em manutenção"
              value={storeCounts ? count(storeCounts.maintenance) : null}
              unavailable={!overview?.stores.available}
            />
            <Kpi
              label="Inativas"
              value={storeCounts ? count(storeCounts.inactive) : null}
              unavailable={!overview?.stores.available}
            />
            <Kpi label="Produtos no catálogo" value={productCount === null ? null : count(productCount)} unavailable={productCount === null} />
          </div>
        </section>

        <p className="text-sm text-muted-foreground">
          Vendas, abastecimento, estoque e reconciliação seguem sendo vistos por loja e mês — escolha uma loja em{" "}
          <Link href="/sales" className="underline underline-offset-2">
            Vendas
          </Link>
          ,{" "}
          <Link href="/supply" className="underline underline-offset-2">
            Abastecimento
          </Link>
          ,{" "}
          <Link href="/inventory" className="underline underline-offset-2">
            Estoque
          </Link>{" "}
          ou{" "}
          <Link href="/finance" className="underline underline-offset-2">
            Reconciliação
          </Link>
          .
        </p>
      </RequestState>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  hint,
  unavailable,
  source,
}: {
  label: string;
  value: string | null;
  tone?: "positive" | "critical";
  hint?: string;
  unavailable?: boolean;
  source?: string;
}) {
  const color = tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
          {label}
          {source && <StatusBadge tone="neutral">{source}</StatusBadge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {unavailable || value === null ? (
          // Nunca um zero fabricado: numa visão geral ele parece um número.
          <p className="flex items-center gap-1 text-sm text-warning">
            <AlertTriangle className="size-4" /> Indisponível
          </p>
        ) : (
          <p className={`tabular text-2xl font-semibold ${color}`}>{value}</p>
        )}
        {hint && !unavailable && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
