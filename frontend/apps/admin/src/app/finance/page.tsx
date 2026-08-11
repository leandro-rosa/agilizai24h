"use client";

import { useMemo } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGetTransactionsQuery } from "@/lib/api/finance";
import { useGetStoresQuery } from "@/lib/api/stores";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function FinancePage() {
  const { data: transactions, isLoading: loadingTransactions } = useGetTransactionsQuery();
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const isLoading = loadingTransactions || loadingStores;

  const storeById = useMemo(() => new Map(stores?.map((store) => [store.id, store])), [stores]);

  const summary = useMemo(() => {
    const list = transactions ?? [];
    const revenue = list.filter((t) => t.type === "revenue").reduce((sum, t) => sum + t.value, 0);
    const expense = list.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.value, 0);
    const revenueEntries = list.filter((t) => t.type === "revenue");
    const averageTicket = revenueEntries.length > 0 ? revenue / revenueEntries.length : 0;
    return { revenue, expense, balance: revenue - expense, averageTicket };
  }, [transactions]);

  const kpis = [
    { label: "Receita total", value: summary.revenue },
    { label: "Despesa total", value: summary.expense },
    { label: "Saldo", value: summary.balance },
    { label: "Ticket médio", value: summary.averageTicket },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Financeiro" description="Receitas, despesas e saldo consolidado das lojas." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <p className="text-2xl font-semibold tracking-tight">{currency.format(kpi.value)}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Loja</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (transactions ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhuma transação encontrada.
                </TableCell>
              </TableRow>
            ) : (
              (transactions ?? []).map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{dateFormat.format(new Date(transaction.date))}</TableCell>
                  <TableCell className="font-medium">{storeById.get(transaction.storeId)?.name ?? transaction.storeId}</TableCell>
                  <TableCell className="text-muted-foreground">{transaction.category}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        transaction.type === "revenue"
                          ? "bg-secondary text-secondary-foreground"
                          : "border border-destructive/30 bg-destructive/10 text-destructive"
                      }
                    >
                      {transaction.type === "revenue" ? "Receita" : "Despesa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {transaction.type === "expense" ? "− " : ""}
                    {currency.format(transaction.value)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
