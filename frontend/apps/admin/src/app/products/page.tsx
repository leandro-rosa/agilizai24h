"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import type { Product } from "@/mocks/products";

const categoryLabel: Record<Product["category"], string> = {
  meal: "Refeição",
  snack: "Lanche",
  beverage: "Bebida",
  essential: "Essencial",
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function ProductsPage() {
  const { data: products, isLoading } = useGetProductsQuery();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = useMemo(() => {
    return (products ?? []).filter((product) => {
      const matchSearch = product.name.toLowerCase().includes(search.toLowerCase()) ||
        product.sku.toLowerCase().includes(search.toLowerCase());
      const matchCategory = category === "all" || product.category === category;
      return matchSearch && matchCategory;
    });
  }, [products, search, category]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Produtos" description="Catálogo de produtos disponíveis nas lojas." />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Buscar por nome ou SKU..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {Object.entries(categoryLabel).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="text-right">Preço</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Nenhum produto encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{product.sku}</TableCell>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{categoryLabel[product.category]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{currency.format(product.price)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
