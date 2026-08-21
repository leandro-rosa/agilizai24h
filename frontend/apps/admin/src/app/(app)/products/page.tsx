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
import {
  useGetCostsAsOfQuery,
  useGetPricesAsOfQuery,
  useGetProductsQuery,
  type Product,
} from "@/lib/api/products";
import { money } from "@/lib/format";

const categoryLabel: Record<Product["category"], string> = {
  meal: "Refeição",
  snack: "Lanche",
  beverage: "Bebida",
  essential: "Essencial",
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProductsPage() {
  const { data: products, isLoading } = useGetProductsQuery();
  const skus = useMemo(() => (products ?? []).map((product) => product.sku), [products]);
  const { data: costs } = useGetCostsAsOfQuery(
    { skus, asOf: todayIso() },
    { skip: skus.length === 0 },
  );

  // Preço na MESMA data do custo. Pedir "preço de hoje" contra "custo do
  // último abastecimento" produziria uma margem que nunca existiu.
  const { data: prices } = useGetPricesAsOfQuery(
    { skus, asOf: todayIso() },
    { skip: skus.length === 0 },
  );

  const priceBySku = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of prices?.resolved ?? []) {
      map.set(entry.sku, entry.price_cents);
    }
    return map;
  }, [prices]);

  const costBySku = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of costs?.resolved ?? []) {
      map.set(entry.sku, entry.cost_cents);
    }
    return map;
  }, [costs]);

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
              <TableHead>EAN</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="tabular text-right">Custo (hoje)</TableHead>
              <TableHead className="tabular text-right">Preço (hoje)</TableHead>
              <TableHead className="tabular text-right">Margem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Nenhum produto encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((product) => {
                const cost = costBySku.get(product.sku);
                const price = priceBySku.get(product.sku);
                // Margem só existe com os DOIS lados na mesma data. Faltando
                // um, é "—" e nunca 0% — que se leria como margem nula real.
                const margin =
                  cost !== undefined && price !== undefined && price > 0 ? (price - cost) / price : null;

                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{product.sku}</TableCell>
                    <TableCell className="font-medium">
                      {product.name}
                      {product.subcategory && (
                        <span className="block text-xs text-muted-foreground">{product.subcategory}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-xs text-muted-foreground">{product.ean ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{categoryLabel[product.category]}</Badge>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {/* Never shown as R$ 0,00: a SKU with no cost recorded is not the same as a SKU that costs nothing. */}
                      {cost === undefined ? (
                        <span className="text-muted-foreground">Sem custo</span>
                      ) : (
                        currency.format(cost / 100)
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {price === undefined ? <span className="text-muted-foreground">Sem preço</span> : money(price)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {margin === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={margin < 0 ? "text-destructive" : ""}>{(margin * 100).toFixed(1)}%</span>
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
