"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGetSalesQuery } from "@/lib/api/sales";
import { useGetStoresQuery } from "@/lib/api/stores";
import type { Sale } from "@/mocks/sales";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const paymentMethodLabel: Record<Sale["paymentMethod"], string> = {
  pix: "Pix",
  card: "Cartão",
  app: "App",
};

const periodOptions = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "all", label: "Todo o período" },
];

const TODAY = new Date("2026-08-11T00:00:00Z").getTime();

export default function SalesPage() {
  const { data: sales, isLoading: loadingSales } = useGetSalesQuery();
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const [storeId, setStoreId] = useState("all");
  const [period, setPeriod] = useState("30");

  const isLoading = loadingSales || loadingStores;
  const storeById = useMemo(() => new Map(stores?.map((store) => [store.id, store])), [stores]);

  const filtered = useMemo(() => {
    const cutoff = period === "all" ? null : TODAY - Number(period) * 24 * 60 * 60 * 1000;
    return (sales ?? []).filter((sale) => {
      const matchStore = storeId === "all" || sale.storeId === storeId;
      const matchPeriod = cutoff === null || new Date(sale.date).getTime() >= cutoff;
      return matchStore && matchPeriod;
    });
  }, [sales, storeId, period]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Vendas" description="Histórico de vendas registradas nas lojas." />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="sm:w-64">
            <SelectValue placeholder="Loja" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as lojas</SelectItem>
            {stores?.map((store) => (
              <SelectItem key={store.id} value={store.id}>
                {store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Loja</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead className="text-right">Valor total</TableHead>
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
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhuma venda encontrada.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>{dateFormat.format(new Date(sale.date))}</TableCell>
                  <TableCell className="font-medium">{storeById.get(sale.storeId)?.name ?? sale.storeId}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {sale.items.reduce((sum, item) => sum + item.quantity, 0)} un.
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{paymentMethodLabel[sale.paymentMethod]}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{currency.format(sale.totalValue)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
