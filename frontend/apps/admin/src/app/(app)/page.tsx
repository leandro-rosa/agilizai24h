"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetOverviewQuery } from "@/lib/api/overview";

/**
 * Only stores + products are network-wide (`GET /overview`) — sales, supply,
 * inventory and finance are all per-store per-period with no aggregate
 * endpoint, so this deliberately doesn't fabricate a network-wide "sales
 * today" or "abastecimentos pendentes" figure the way the old mock did:
 * neither exists in the real data (sales has no daily grain, and there is no
 * purchasing-workflow concept at all — see `supply`'s rebuild).
 */
export default function DashboardPage() {
  const { data: overview, isLoading, error, refetch } = useGetOverviewQuery();

  const storeCounts = useMemo(() => {
    if (!overview?.stores.available) return null;
    const byStatus = { active: 0, maintenance: 0, inactive: 0 };
    for (const store of overview.stores.data) byStatus[store.status] += 1;
    return byStatus;
  }, [overview]);

  const productCount = overview?.products.available ? overview.products.data.length : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Visão geral" description="Resumo das operações do Agiliz.AI." />

      <RequestState isLoading={isLoading} error={error} onRetry={refetch}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Lojas ativas</CardTitle>
            </CardHeader>
            <CardContent>
              {!overview?.stores.available ? (
                <p className="flex items-center gap-1 text-sm text-warning">
                  <AlertTriangle className="size-4" /> Indisponível
                </p>
              ) : (
                <p className="tabular text-2xl font-semibold tracking-tight">{storeCounts?.active}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Em manutenção</CardTitle>
            </CardHeader>
            <CardContent>
              {!overview?.stores.available ? (
                <p className="flex items-center gap-1 text-sm text-warning">
                  <AlertTriangle className="size-4" /> Indisponível
                </p>
              ) : (
                <p className="tabular text-2xl font-semibold tracking-tight">{storeCounts?.maintenance}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Inativas</CardTitle>
            </CardHeader>
            <CardContent>
              {!overview?.stores.available ? (
                <p className="flex items-center gap-1 text-sm text-warning">
                  <AlertTriangle className="size-4" /> Indisponível
                </p>
              ) : (
                <p className="tabular text-2xl font-semibold tracking-tight">{storeCounts?.inactive}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Produtos no catálogo</CardTitle>
            </CardHeader>
            <CardContent>
              {productCount === null ? (
                <p className="flex items-center gap-1 text-sm text-warning">
                  <AlertTriangle className="size-4" /> Indisponível
                </p>
              ) : (
                <p className="tabular text-2xl font-semibold tracking-tight">{productCount}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Vendas, abastecimento, estoque e financeiro são vistos por loja e mês — escolha uma loja em{" "}
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
            Financeiro
          </Link>
          .
        </p>
      </RequestState>
    </div>
  );
}
