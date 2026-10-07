"use client";

import { ChevronDown, Eye, FileSpreadsheet, Pencil, Tags, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetCategoriesQuery, useGetCostsAsOfQuery, useGetPricesAsOfQuery, useGetProductsQuery, type Product } from "@/lib/api/products";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { money } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/products/labels";
import { categoryName } from "@/lib/products/taxonomy";
import { CatalogueImportDialog } from "./catalogue-import-dialog";
import { EditProductDialog } from "./edit-product-dialog";
import { DRAWER_TABS, ProductDrawer, type DrawerTab } from "./product-drawer";

const dayText = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Procura por nome, SKU ou QUALQUER EAN do produto, inclusive os inativos: uma nota antiga ainda traz o código antigo. */
function matchesSearch(product: Product, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;

  return product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle) || (product.ean ?? "").includes(needle) || (product.eans ?? []).some((ean) => ean.ean.includes(needle));
}

/**
 * O catálogo: todos os produtos, inclusive os novos e os sem preço, sobre o mesmo cadastro que as outras áreas usam. A tabela é de manutenção: identificação,
 * categoria, EAN, unidade, último custo unitário com a data e o preço vigente (ou "Preço pendente", com o atalho para precificar). A análise de margem fica na Precificação.
 */
export function CatalogueView({ canWrite, importing, onImportingChange }: { canWrite: boolean; importing: boolean; onImportingChange: (open: boolean) => void }) {
  const { data: products, isLoading } = useGetProductsQuery();
  const categories = useGetCategoriesQuery().data;
  const suppliers = useGetSuppliersQuery().data;
  const skus = useMemo(() => (products ?? []).map((product) => product.sku), [products]);
  const { data: costs } = useGetCostsAsOfQuery({ skus, asOf: todayIso() }, { skip: skus.length === 0 });
  // Preço na MESMA data do custo: o vigente hoje. Sem preço vigente o produto está "pendente de preço", nunca com preço zero.
  const { data: prices } = useGetPricesAsOfQuery({ skus, asOf: todayIso() }, { skip: skus.length === 0 });
  const costBySku = useMemo(() => new Map((costs?.resolved ?? []).map((entry) => [entry.sku, { cents: entry.cost_cents, from: entry.effective_from }])), [costs]);
  const priceBySku = useMemo(() => new Map((prices?.resolved ?? []).map((entry) => [entry.sku, { cents: entry.price_cents, from: entry.effective_from }])), [prices]);
  const supplierById = useMemo(() => new Map((suppliers ?? []).map((supplier) => [supplier.id, supplier.name])), [suppliers]);
  const supplierName = (id: number | null | undefined) => (id ? (supplierById.get(id) ?? `Fornecedor ${id}`) : null);

  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");

  // O produto aberto vem da URL (`?sku=…&tab=…`): é o link de "Ver produto" das notas e das mensagens de EAN.
  const router = useRouter();
  const params = useSearchParams();
  const openSku = params.get("sku");
  const rawTab = params.get("tab");
  const tab: DrawerTab = DRAWER_TABS.includes(rawTab as DrawerTab) ? (rawTab as DrawerTab) : "overview";
  const open = openSku ? (products ?? []).find((product) => product.sku === openSku) : undefined;
  const openProduct = (product: Product, nextTab: DrawerTab = "overview") => router.replace(`/products?sku=${encodeURIComponent(product.sku)}&tab=${nextTab}`, { scroll: false });
  const closeProduct = () => router.replace("/products", { scroll: false });

  const filtered = useMemo(
    () => (products ?? []).filter((product) => (category === "all" || product.category === category) && (status === "all" || (product.status ?? "active") === status) && matchesSearch(product, search)),
    [products, search, category, status],
  );

  async function exportExcel() {
    try {
      const { downloadProductsWorkbook } = await import("@/lib/products/excel");
      downloadProductsWorkbook(filtered.map((product) => ({ product, categoryName: categoryName(product.category, categories), costCents: costBySku.get(product.sku)?.cents ?? null, costDate: costBySku.get(product.sku)?.from ?? null })));
    } catch (error) {
      console.error("Exportar produtos falhou", error);
      toast.error("Não foi possível gerar a planilha.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Input placeholder="Buscar nome, SKU ou EAN..." value={search} onChange={(event) => setSearch(event.target.value)} className="lg:max-w-xs" aria-label="Buscar produto" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="lg:w-48" aria-label="Categoria">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {(categories ?? []).map((row) => (
              <SelectItem key={row.key} value={row.key}>
                {row.name}
                {row.status === "inactive" ? " (inativa)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="lg:w-44" aria-label="Situação">
            <SelectValue placeholder="Situação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 lg:ml-auto">
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Upload /> Importar Excel <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onImportingChange(true)}>Catálogo de produtos (com modelo e mapeamento)</DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/products/sync">Planilha de precificação (custos e preços)</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={isLoading || filtered.length === 0} title="Baixa os produtos que estão na lista, com os filtros aplicados">
            <FileSpreadsheet /> Exportar catálogo
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Categoria / subcategoria</TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>Unidade de venda</TableHead>
              <TableHead className="tabular text-right">Último custo unitário</TableHead>
              <TableHead className="tabular text-right">Preço vigente</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Nenhum produto encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((product) => {
                const cost = costBySku.get(product.sku);
                const price = priceBySku.get(product.sku);
                const extraEans = Math.max(0, (product.eans ?? []).filter((ean) => ean.status === "active").length - 1);

                return (
                  <TableRow key={product.id}>
                    <TableCell className="whitespace-normal font-medium">
                      {product.name}
                      <span className="block font-mono text-xs font-normal text-muted-foreground">
                        SKU {product.sku}
                        {product.brand ? ` · ${product.brand}` : ""}
                        {supplierName(product.supplier_id) ? ` · ${supplierName(product.supplier_id)}` : ""}
                      </span>
                      {product.origin?.type === "invoice" && <StatusBadge tone="attention">Cadastrado por NF-e</StatusBadge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{categoryName(product.category, categories)}</Badge>
                      {product.subcategory && <span className="block text-xs text-muted-foreground">{product.subcategory}</span>}
                    </TableCell>
                    <TableCell className="tabular text-xs text-muted-foreground">
                      {product.ean ?? "—"}
                      {extraEans > 0 && (
                        <span className="ml-1 text-foreground" title="Códigos de barras adicionais ativos">
                          +{extraEans}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {product.sale_unit ?? "un"}
                      {product.units_per_package ? <span className="block text-muted-foreground">{product.units_per_package} un. por {product.package_type ?? "embalagem"}</span> : null}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {/* Never shown as R$ 0,00: a SKU with no cost recorded is not the same as a SKU that costs nothing. */}
                      {cost === undefined ? (
                        <span className="text-muted-foreground">Sem custo</span>
                      ) : (
                        <>
                          {currency.format(cost.cents / 100)}
                          <span className="block text-xs text-muted-foreground">desde {dayText(cost.from)}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {price === undefined ? (
                        <StatusBadge tone="attention">Preço pendente</StatusBadge>
                      ) : (
                        <>
                          {money(price.cents)}
                          <span className="block text-xs text-muted-foreground">desde {dayText(price.from)}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{STATUS_LABEL[product.status ?? "active"] ?? product.status}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" title="Abrir cadastro" aria-label={`Abrir ${product.name}`} onClick={() => openProduct(product)}>
                        <Eye />
                      </Button>
                      <Button variant="ghost" size="icon" title="Precificar: análise, simulação e aprovação" aria-label={`Precificar ${product.name}`} asChild>
                        <Link href={`/products?view=pricing&sku=${encodeURIComponent(product.sku)}`}>
                          <Tags />
                        </Link>
                      </Button>
                      {canWrite && (
                        <Button variant="ghost" size="icon" title="Editar produto" aria-label={`Editar ${product.name}`} onClick={() => setEditing(product)}>
                          <Pencil />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {importing && <CatalogueImportDialog open onOpenChange={onImportingChange} />}
      {open && <ProductDrawer product={open} supplierName={supplierName} tab={tab} onTabChange={(next) => openProduct(open, next)} onClose={closeProduct} canWrite={canWrite} onEdit={() => setEditing(open)} />}
      {editing && <EditProductDialog key={editing.id} product={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
