"use client";

import { useMemo } from "react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetInventoryQuery } from "@/lib/api/inventory";
import { useGetSalesQuery } from "@/lib/api/sales";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useGetSupplyRequestsQuery } from "@/lib/api/supply";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function isToday(iso: string) {
  const today = new Date("2026-08-11T00:00:00Z");
  const date = new Date(iso);
  return (
    date.getUTCFullYear() === today.getUTCFullYear() &&
    date.getUTCMonth() === today.getUTCMonth() &&
    date.getUTCDate() === today.getUTCDate()
  );
}

export default function DashboardPage() {
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: sales, isLoading: loadingSales } = useGetSalesQuery();
  const { data: inventory, isLoading: loadingInventory } = useGetInventoryQuery();
  const { data: supplyRequests, isLoading: loadingSupply } = useGetSupplyRequestsQuery();

  const isLoading = loadingStores || loadingSales || loadingInventory || loadingSupply;

  const kpis = useMemo(() => {
    const activeStores = (stores ?? []).filter((store) => store.status === "active").length;
    const salesToday = (sales ?? []).filter((sale) => isToday(sale.date));
    const salesTodayValue = salesToday.reduce((sum, sale) => sum + sale.totalValue, 0);
    const belowMinimum = (inventory ?? []).filter((item) => item.quantity < item.minimum).length;
    const pendingRequests = (supplyRequests ?? []).filter((item) => item.status === "pending").length;

    return [
      { label: "Lojas ativas", value: String(activeStores) },
      { label: "Vendas hoje", value: currency.format(salesTodayValue) },
      { label: "Itens abaixo do mínimo", value: String(belowMinimum) },
      { label: "Abastecimentos pendentes", value: String(pendingRequests) },
    ];
  }, [stores, sales, inventory, supplyRequests]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Visão geral" description="Resumo das operações do Agiliz.AI." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <p className="text-2xl font-semibold tracking-tight">{kpi.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
