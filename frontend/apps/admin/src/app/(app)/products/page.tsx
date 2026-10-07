"use client";

import { Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { DRAWER_TABS, ProductDrawer, type DrawerTab } from "@/components/products/product-drawer";
import { ResourceFormDialog, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetCostsAsOfQuery, useGetPricesAsOfQuery, useGetProductsQuery, useUpdateProductMutation, type Product } from "@/lib/api/products";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { useHasPermission } from "@/lib/auth/use-permission";
import { money } from "@/lib/format";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/lib/products/labels";

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
  saleUnit: z.string().optional(),
  status: z.string().optional(),
  unitsPerPackage: z.string().optional(),
  packageType: z.string().optional(),
  fractionable: z.boolean().optional(),
});

type EditForm = z.infer<typeof editSchema>;

const EDIT_FIELDS: FieldSpec<EditForm>[] = [
  { name: "name", label: "Nome", kind: "text" },
  { name: "subcategory", label: "Subcategoria", kind: "text" },
  { name: "saleUnit", label: "Unidade de venda", kind: "text", placeholder: "un" },
  { name: "status", label: "Situação", kind: "select", options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })), hint: "Descontinuar não apaga o histórico." },
  { name: "unitsPerPackage", label: "Unidades por embalagem", kind: "number", placeholder: "24" },
  { name: "packageType", label: "Tipo de embalagem", kind: "select", options: PACKAGE_TYPES.map((type) => ({ value: type, label: type })) },
  { name: "fractionable", label: "Fracionável", kind: "checkbox", hint: "Pode ser vendido em unidades soltas, fora da embalagem original." },
];

function toEditForm(product: Product): EditForm {
  return {
    name: product.name,
    subcategory: product.subcategory ?? "",
    saleUnit: product.sale_unit ?? "un",
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
  const suppliers = useGetSuppliersQuery().data;
  const skus = useMemo(() => (products ?? []).map((product) => product.sku), [products]);
  const { data: costs } = useGetCostsAsOfQuery({ skus, asOf: todayIso() }, { skip: skus.length === 0 });

  // Preço na MESMA data do custo. Pedir "preço de hoje" contra "custo do
  // último abastecimento" produziria uma margem que nunca existiu.
  const { data: prices } = useGetPricesAsOfQuery({ skus, asOf: todayIso() }, { skip: skus.length === 0 });

  const priceBySku = useMemo(() => new Map((prices?.resolved ?? []).map((entry) => [entry.sku, entry.price_cents])), [prices]);
  const costBySku = useMemo(() => new Map((costs?.resolved ?? []).map((entry) => [entry.sku, entry.cost_cents])), [costs]);
  const supplierById = useMemo(() => new Map((suppliers ?? []).map((supplier) => [supplier.id, supplier.name])), [suppliers]);
  const supplierName = (id: number | null | undefined) => (id ? (supplierById.get(id) ?? `Fornecedor ${id}`) : null);

  const [updateProduct] = useUpdateProductMutation();
  const canWrite = useHasPermission("products:write");
  const [editing, setEditing] = useState<Product | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [status, setStatus] = useState("all");

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

  const supplierOptions = useMemo(() => {
    const ids = new Set((products ?? []).map((product) => product.supplier_id).filter((id): id is number => typeof id === "number"));

    return [...ids].map((id) => ({ id, name: supplierById.get(id) ?? `Fornecedor ${id}` })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [products, supplierById]);

  const filtered = useMemo(
    () =>
      (products ?? []).filter((product) => {
        const matchCategory = category === "all" || product.category === category;
        const matchSupplier = supplier === "all" || (supplier === "none" ? !product.supplier_id : String(product.supplier_id) === supplier);
        const matchStatus = status === "all" || (product.status ?? "active") === status;

        return matchesSearch(product, search) && matchCategory && matchSupplier && matchStatus;
      }),
    [products, search, category, supplier, status],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Produtos"
        description="Cadastro de produtos: identificação, códigos de barras, custos, preços e o histórico de cada um."
        actions={
          canWrite ? (
            <Link href="/products/sync" className="text-sm font-medium text-primary hover:underline">
              Sincronizar com a precificação →
            </Link>
          ) : null
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
        <Select value={supplier} onValueChange={setSupplier}>
          <SelectTrigger className="lg:w-52" aria-label="Fornecedor">
            <SelectValue placeholder="Fornecedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os fornecedores</SelectItem>
            <SelectItem value="none">Sem fornecedor</SelectItem>
            {supplierOptions.map((option) => (
              <SelectItem key={option.id} value={String(option.id)}>
                {option.name}
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
              <TableHead>EAN</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="tabular text-right">Custo (hoje)</TableHead>
              <TableHead className="tabular text-right">Preço (hoje)</TableHead>
              <TableHead className="tabular text-right">Margem</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  Nenhum produto encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((product) => {
                const cost = costBySku.get(product.sku);
                const price = priceBySku.get(product.sku);
                // Margem só existe com os DOIS lados na mesma data. Faltando
                // um, é "—" e nunca 0% — que se leria como margem nula real.
                const margin = cost !== undefined && price !== undefined && price > 0 ? (price - cost) / price : null;
                const extraEans = Math.max(0, (product.eans ?? []).filter((ean) => ean.status === "active").length - 1);

                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{product.sku}</TableCell>
                    <TableCell className="font-medium">
                      {product.name}
                      {product.subcategory && <span className="block text-xs text-muted-foreground">{product.subcategory}</span>}
                      {product.origin?.type === "invoice" && <StatusBadge tone="attention">Cadastrado por NF-e</StatusBadge>}
                    </TableCell>
                    <TableCell className="tabular text-xs text-muted-foreground">
                      {product.ean ?? "—"}
                      {extraEans > 0 && <span className="ml-1 text-foreground">+{extraEans}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{CATEGORY_LABEL[product.category]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{supplierName(product.supplier_id) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="tabular text-right">
                      {/* Never shown as R$ 0,00: a SKU with no cost recorded is not the same as a SKU that costs nothing. */}
                      {cost === undefined ? <span className="text-muted-foreground">Sem custo</span> : currency.format(cost / 100)}
                    </TableCell>
                    <TableCell className="tabular text-right">{price === undefined ? <span className="text-muted-foreground">Sem preço</span> : money(price)}</TableCell>
                    <TableCell className="tabular text-right">
                      {margin === null ? <span className="text-muted-foreground">—</span> : <span className={margin < 0 ? "text-destructive" : ""}>{(margin * 100).toFixed(1)}%</span>}
                    </TableCell>
                    <TableCell className="text-xs">{STATUS_LABEL[product.status ?? "active"] ?? product.status}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" title="Ver produto" aria-label={`Ver ${product.name}`} onClick={() => openProduct(product)}>
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
                saleUnit: values.saleUnit?.trim() || undefined,
                status: values.status === "discontinued" ? "discontinued" : "active",
                unitsPerPackage: values.unitsPerPackage ? Number(values.unitsPerPackage) : undefined,
                packageType: values.packageType || undefined,
                fractionable: values.fractionable,
              },
            }).unwrap()
          }
        />
      )}
    </div>
  );
}
