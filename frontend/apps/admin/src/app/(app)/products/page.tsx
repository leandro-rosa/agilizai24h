"use client";

import { ChevronDown, Eye, FileSpreadsheet, Pencil, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { CatalogueImportDialog } from "@/components/products/catalogue-import-dialog";
import { NewProductDialog } from "@/components/products/new-product-dialog";
import { DRAWER_TABS, ProductDrawer, type DrawerTab } from "@/components/products/product-drawer";
import { ResourceFormDialog, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetCostsAsOfQuery, useGetProductsQuery, useUpdateProductMutation, type Product } from "@/lib/api/products";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { useHasPermission } from "@/lib/auth/use-permission";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/lib/products/labels";

const dayText = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Fixed list of the package types the operation actually uses. Not free text —
// a closed set keeps "caixa"/"Caixa"/"cx" from fragmenting into synonyms across
// products.
const PACKAGE_TYPES = ["caixa", "fardo", "pacote", "unidade"];

const editSchema = z.object({
  name: z.string().min(1, "Informe o nome"),
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  saleUnit: z.string().optional(),
  purchaseUnit: z.string().optional(),
  status: z.string().optional(),
  unitsPerPackage: z.string().optional(),
  packageType: z.string().optional(),
  fractionable: z.boolean().optional(),
});

type EditForm = z.infer<typeof editSchema>;

const EDIT_FIELDS: FieldSpec<EditForm>[] = [
  { name: "name", label: "Nome", kind: "text" },
  { name: "subcategory", label: "Subcategoria", kind: "text" },
  { name: "brand", label: "Marca", kind: "text" },
  { name: "saleUnit", label: "Unidade de venda", kind: "text", placeholder: "un" },
  { name: "purchaseUnit", label: "Unidade de compra (como o fornecedor vende)", kind: "text", placeholder: "CX" },
  { name: "status", label: "Situação", kind: "select", options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })), hint: "Descontinuar não apaga o histórico." },
  { name: "unitsPerPackage", label: "Fator: unidades por caixa/fardo", kind: "number", placeholder: "24", hint: "O custo é sempre guardado por unidade vendida: custo da caixa ÷ este fator." },
  { name: "packageType", label: "Tipo de embalagem", kind: "select", options: PACKAGE_TYPES.map((type) => ({ value: type, label: type })) },
  { name: "fractionable", label: "Fracionável", kind: "checkbox", hint: "Pode ser vendido em unidades soltas, fora da embalagem original." },
];

function toEditForm(product: Product): EditForm {
  return {
    name: product.name,
    subcategory: product.subcategory ?? "",
    brand: product.brand ?? "",
    saleUnit: product.sale_unit ?? "un",
    purchaseUnit: product.purchase_unit ?? "",
    status: product.status ?? "active",
    unitsPerPackage: product.units_per_package !== null ? String(product.units_per_package) : "",
    packageType: product.package_type ?? "",
    fractionable: product.fractionable ?? false,
  };
}

/** Procura por nome, SKU ou QUALQUER EAN do produto, inclusive os inativos: uma nota antiga ainda traz o código antigo. */
function matchesSearch(product: Product, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;

  return (
    product.name.toLowerCase().includes(needle) ||
    product.sku.toLowerCase().includes(needle) ||
    (product.ean ?? "").includes(needle) ||
    (product.eans ?? []).some((ean) => ean.ean.includes(needle))
  );
}

export default function ProductsPage() {
  const { data: products, isLoading } = useGetProductsQuery();
  const skus = useMemo(() => (products ?? []).map((product) => product.sku), [products]);
  const { data: costs } = useGetCostsAsOfQuery({ skus, asOf: todayIso() }, { skip: skus.length === 0 });

  // Último custo unitário e o dia em que passou a valer (o vigente hoje). Preço e margem não estão aqui: a análise é da Precificação.
  const costBySku = useMemo(() => new Map((costs?.resolved ?? []).map((entry) => [entry.sku, { cents: entry.cost_cents, from: entry.effective_from }])), [costs]);
  const suppliers = useGetSuppliersQuery().data;
  const supplierById = useMemo(() => new Map((suppliers ?? []).map((supplier) => [supplier.id, supplier.name])), [suppliers]);
  const supplierName = (id: number | null | undefined) => (id ? (supplierById.get(id) ?? `Fornecedor ${id}`) : null);

  const [updateProduct] = useUpdateProductMutation();
  const canWrite = useHasPermission("products:write");
  const [editing, setEditing] = useState<Product | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  // O produto aberto vem da URL (`?sku=…&tab=…`): é o link de "Ver produto" das notas e das mensagens de EAN.
  const router = useRouter();
  const params = useSearchParams();
  const openSku = params.get("sku");
  const rawTab = params.get("tab");
  const tab: DrawerTab = DRAWER_TABS.includes(rawTab as DrawerTab) ? (rawTab as DrawerTab) : "overview";
  const open = openSku ? (products ?? []).find((product) => product.sku === openSku) : undefined;

  function openProduct(product: Product, nextTab: DrawerTab = "overview") {
    router.replace(`/products?sku=${encodeURIComponent(product.sku)}&tab=${nextTab}`, { scroll: false });
  }
  const closeProduct = () => router.replace("/products", { scroll: false });

  const filtered = useMemo(
    () =>
      (products ?? []).filter((product) => {
        const matchCategory = category === "all" || product.category === category;
        const matchStatus = status === "all" || (product.status ?? "active") === status;

        return matchesSearch(product, search) && matchCategory && matchStatus;
      }),
    [products, search, category, status],
  );

  async function exportExcel() {
    try {
      const { downloadProductsWorkbook } = await import("@/lib/products/excel");
      downloadProductsWorkbook(filtered.map((product) => ({ product, costCents: costBySku.get(product.sku)?.cents ?? null, costDate: costBySku.get(product.sku)?.from ?? null })));
    } catch (error) {
      console.error("Exportar produtos falhou", error);
      toast.error("Não foi possível gerar a planilha.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Produtos"
        description="Cadastro único de produtos: identificação, códigos de barras, unidades e custos. Compras, Estoque, Vendas, Abastecimento e Precificação usam este mesmo cadastro."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> Novo produto
              </Button>
            )}
            {canWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Upload /> Importar Excel <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setImporting(true)}>Catálogo de produtos (com modelo e mapeamento)</DropdownMenuItem>
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
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row">
        <Input placeholder="Buscar por nome, SKU ou EAN..." value={search} onChange={(event) => setSearch(event.target.value)} className="lg:max-w-xs" aria-label="Buscar produto" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="lg:w-44" aria-label="Categoria">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
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
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>Unidade de venda</TableHead>
              <TableHead className="tabular text-right">Último custo unitário</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-24" />
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
                const extraEans = Math.max(0, (product.eans ?? []).filter((ean) => ean.status === "active").length - 1);

                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{product.sku}</TableCell>
                    <TableCell className="font-medium">
                      {product.name}
                      {product.brand && <span className="block text-xs text-muted-foreground">{product.brand}</span>}
                      {product.origin?.type === "invoice" && <StatusBadge tone="attention">Cadastrado por NF-e</StatusBadge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{CATEGORY_LABEL[product.category]}</Badge>
                      {product.subcategory && <span className="block text-xs text-muted-foreground">{product.subcategory}</span>}
                    </TableCell>
                    <TableCell className="tabular text-xs text-muted-foreground">
                      {product.ean ?? "—"}
                      {extraEans > 0 && <span className="ml-1 text-foreground" title="Códigos de barras adicionais ativos">+{extraEans}</span>}
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
                    <TableCell className="text-xs">{STATUS_LABEL[product.status ?? "active"] ?? product.status}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" title="Abrir cadastro" aria-label={`Abrir ${product.name}`} onClick={() => openProduct(product)}>
                        <Eye />
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

      {creating && <NewProductDialog open onOpenChange={setCreating} onCreated={(product) => openProduct(product)} />}
      {importing && <CatalogueImportDialog open onOpenChange={setImporting} />}

      {open && <ProductDrawer product={open} supplierName={supplierName} tab={tab} onTabChange={(next) => openProduct(open, next)} onClose={closeProduct} canWrite={canWrite} onEdit={() => setEditing(open)} />}

      {editing && (
        <ResourceFormDialog
          key={editing.id}
          title={`Editar produto — ${editing.name}`}
          schema={editSchema}
          fields={EDIT_FIELDS}
          defaultValues={toEditForm(editing)}
          open
          onOpenChange={(next) => !next && setEditing(null)}
          onSubmit={(values) =>
            updateProduct({
              id: editing.id,
              changes: {
                name: values.name.trim(),
                subcategory: values.subcategory?.trim() ? values.subcategory.trim() : null,
                brand: values.brand?.trim() ? values.brand.trim() : null,
                saleUnit: values.saleUnit?.trim() || undefined,
                purchaseUnit: values.purchaseUnit?.trim() ? values.purchaseUnit.trim() : null,
                status: values.status === "discontinued" ? "discontinued" : "active",
                unitsPerPackage: values.unitsPerPackage ? Number(values.unitsPerPackage) : null,
                packageType: values.packageType || null,
                fractionable: values.fractionable,
              },
            }).unwrap()
          }
        />
      )}
    </div>
  );
}
