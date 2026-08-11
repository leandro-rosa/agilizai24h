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
import { useGetInventoryQuery } from "@/lib/api/inventory";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetStoresQuery } from "@/lib/api/stores";

export default function InventoryPage() {
  const { data: inventory, isLoading: loadingInventory } = useGetInventoryQuery();
  const { data: products, isLoading: loadingProducts } = useGetProductsQuery();
  const { data: stores, isLoading: loadingStores } = useGetStoresQuery();
  const [storeId, setStoreId] = useState("all");

  const isLoading = loadingInventory || loadingProducts || loadingStores;

  const productById = useMemo(() => new Map(products?.map((product) => [product.id, product])), [products]);
  const storeById = useMemo(() => new Map(stores?.map((store) => [store.id, store])), [stores]);

  const filtered = useMemo(() => {
    return (inventory ?? []).filter((item) => storeId === "all" || item.storeId === storeId);
  }, [inventory, storeId]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Estoque" description="Quantidade disponível por loja e alerta de reposição." />

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
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Loja</TableHead>
              <TableHead className="text-right">Quantidade</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead>Situação</TableHead>
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
                  Nenhum item de estoque encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => {
                const belowMinimum = item.quantity < item.minimum;
                const nearMinimum = !belowMinimum && item.quantity < item.minimum * 1.5;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{productById.get(item.productId)?.name ?? item.productId}</TableCell>
                    <TableCell className="text-muted-foreground">{storeById.get(item.storeId)?.name ?? item.storeId}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{item.minimum}</TableCell>
                    <TableCell>
                      {belowMinimum ? (
                        <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">
                          Abaixo do mínimo
                        </Badge>
                      ) : nearMinimum ? (
                        <Badge className="border border-warning/30 bg-warning/15 text-warning">Atenção</Badge>
                      ) : (
                        <Badge variant="secondary">Ok</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
