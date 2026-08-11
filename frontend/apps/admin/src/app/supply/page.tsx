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
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useGetSupplyRequestsQuery } from "@/lib/api/supply";
import type { SupplyRequest } from "@/mocks/supply";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const statusVariant: Record<SupplyRequest["status"], { label: string; className: string }> = {
  pending: { label: "Pendente", className: "border border-warning/30 bg-warning/15 text-warning" },
  scheduled: { label: "Agendado", className: "bg-secondary text-secondary-foreground" },
  completed: { label: "Concluído", className: "border border-primary/30 bg-primary/10 text-primary" },
};

export default function SupplyPage() {
  const { data: requests, isLoading: loadingRequests } = useGetSupplyRequestsQuery();
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const { data: products, isLoading: loadingProducts } = useGetProductsQuery();
  const [status, setStatus] = useState("all");

  const isLoading = loadingRequests || loadingStores || loadingProducts;
  const storeById = useMemo(() => new Map(stores?.map((store) => [store.id, store])), [stores]);
  const productById = useMemo(() => new Map(products?.map((product) => [product.id, product])), [products]);

  const filtered = useMemo(() => {
    return (requests ?? []).filter((item) => status === "all" || item.status === status);
  }, [requests, status]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Abastecimento" description="Solicitações de reposição pendentes e agendadas." />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="scheduled">Agendado</SelectItem>
            <SelectItem value="completed">Concluído</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Quantidade</TableHead>
              <TableHead>Data agendada</TableHead>
              <TableHead>Status</TableHead>
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
                  Nenhuma solicitação encontrada.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{storeById.get(item.storeId)?.name ?? item.storeId}</TableCell>
                  <TableCell className="text-muted-foreground">{productById.get(item.productId)?.name ?? item.productId}</TableCell>
                  <TableCell className="text-right">{item.requestedQuantity}</TableCell>
                  <TableCell>{dateFormat.format(new Date(item.scheduledDate))}</TableCell>
                  <TableCell>
                    <Badge className={statusVariant[item.status].className}>{statusVariant[item.status].label}</Badge>
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
