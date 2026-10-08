"use client";

import { BarChart3, ChevronDown, FileSpreadsheet, FolderTree, MoreVertical, Plus, RefreshCw, Settings, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CalculationSheet } from "@/components/pricing/calculation-sheet";
import { RulesDialog } from "@/components/pricing/rules-dialog";
import { setupNotes } from "@/components/pricing/setup-banner";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetCurrentPricingQuery } from "@/lib/api/pricing";
import { useGetCategoriesQuery, useGetCostsAsOfQuery, useGetPricesAsOfQuery, useGetProductsQuery, type Product } from "@/lib/api/products";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { useHasPermission } from "@/lib/auth/use-permission";
import { money, period as formatPeriod } from "@/lib/format";
import { incompleteSummary, isClassified } from "@/lib/pricing/operating";
import { percent } from "@/lib/pricing/labels";
import { categoryName } from "@/lib/products/taxonomy";
import {
  buildPendencyGroups,
  buildRows,
  filterRows,
  isBelowTarget,
  NO_WORKSPACE_FILTERS,
  pendencySummary,
  QUICK_FILTER_LABEL,
  quickCounts,
  SITUATION_LABEL,
  sortRows,
  type Dated,
  type PendencyGroup,
  type QuickFilter,
  type SortKey,
  type WorkspaceFilters,
  type WorkspaceRow,
} from "@/lib/products/workspace";
import { cn } from "@/lib/utils";
import { BatchReviewDialog } from "./batch-review-dialog";
import { CatalogueImportDialog } from "./catalogue-import-dialog";
import { EditProductDialog } from "./edit-product-dialog";
import { NewProductPanel } from "./new-product-panel";
import { PendenciesDialog } from "./pendencies-dialog";
import { DRAWER_TABS, ProductDrawer, type DrawerTab } from "./product-drawer";
import { PriceReviewPanel, SITUATION_TONE } from "./price-review-panel";

const todayIso = () => new Date().toISOString().slice(0, 10);
const NETWORK = "network";
const ALL = "all";

const COLUMNS: { key: SortKey; label: string; sub?: string; align: "left" | "right" }[] = [
  { key: "name", label: "Produto", align: "left" },
  { key: "cost", label: "Custo/un.", align: "right" },
  { key: "price", label: "Preço atual", align: "right" },
  { key: "suggested", label: "Sugerido", align: "right" },
  { key: "margin", label: "Margem atual", sub: "de contribuição", align: "right" },
  { key: "situation", label: "Situação", align: "left" },
];

/**
 * A lista única de produtos: cadastro, custo, preço e decisão de preço no mesmo lugar. A lista mostra o custo e o preço de HOJE; a sugestão, a margem e a
 * situação vêm do último cálculo guardado, e só quando ele ainda descreve o preço e o custo de hoje (senão a linha pede para recalcular, em vez de mostrar
 * uma margem velha). Clicar numa linha abre o painel de revisão do preço; o histórico por período fica em "Analisar período".
 */
export function ProductsWorkspace({ onViewPeriod, onCategories }: { onViewPeriod: () => void; onCategories: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const canWrite = useHasPermission("products:write");

  const { data: products, isLoading, error, refetch } = useGetProductsQuery();
  const categories = useGetCategoriesQuery().data;
  const suppliers = useGetSuppliersQuery().data;
  const { data: stores } = useGetStoresQuery();
  const skus = useMemo(() => (products ?? []).map((product) => product.sku), [products]);
  const costsQuery = useGetCostsAsOfQuery({ skus, asOf: todayIso() }, { skip: skus.length === 0 });
  // Preço na MESMA data do custo: o vigente hoje. Sem preço vigente o produto está "sem preço", nunca com preço zero.
  const pricesQuery = useGetPricesAsOfQuery({ skus, asOf: todayIso() }, { skip: skus.length === 0 });

  const [storeId, setStoreId] = useState<number | null>(null);
  // A decisão de HOJE: o cálculo é feito na hora, com o custo e o preço vigentes hoje (nada é guardado nem fica velho). Os relatórios por período
  // ficam em "Analisar período".
  const currentQuery = useGetCurrentPricingQuery({ storeId });
  const report = currentQuery.data ?? null;
  const calculating = currentQuery.isFetching;
  // Se custo ou preço de hoje não puderam ser lidos, a lista NÃO finge que nenhum produto tem preço: diz que não leu.
  const registryFailed = costsQuery.isError || pricesQuery.isError;
  const calculationFailed = currentQuery.isError && !currentQuery.isFetching;
  const reportRows = report ? report.products : null;

  const costs = useMemo(() => new Map<string, Dated>((costsQuery.data?.resolved ?? []).map((entry) => [entry.sku, { cents: entry.cost_cents, from: entry.effective_from, source: entry.source, invoiceNumber: entry.invoice_number ?? null }])), [costsQuery.data]);
  const prices = useMemo(() => new Map<string, Dated>((pricesQuery.data?.resolved ?? []).map((entry) => [entry.sku, { cents: entry.price_cents, from: entry.effective_from }])), [pricesQuery.data]);
  const rows = useMemo(() => buildRows({ products: products ?? [], costs, prices, report: reportRows }), [products, costs, prices, reportRows]);
  const counts = useMemo(() => quickCounts(rows), [rows]);

  // A lista pode abrir já filtrada por categoria e subcategoria (o link "produtos vinculados" das Categorias).
  const [filters, setFilters] = useState<WorkspaceFilters>(() => ({ ...NO_WORKSPACE_FILTERS, category: params.get("category") ?? ALL, subcategory: params.get("subcategory") ?? ALL }));
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "situation", direction: "asc" });
  const visible = useMemo(() => sortRows(filterRows(rows, filters), sort.key, sort.direction), [rows, filters, sort]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.product.sku)), [rows, selected]);

  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendenciesOpen, setPendenciesOpen] = useState(false);
  const [batching, setBatching] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  // O produto aberto vem da URL. `?sku=` abre o painel de preço; `?sku=&tab=` abre o cadastro completo (os links de "Corrigir custo", "Ver produto" e de EAN).
  const openSku = params.get("sku");
  const rawTab = params.get("tab");
  const recordTab: DrawerTab | null = DRAWER_TABS.includes(rawTab as DrawerTab) ? (rawTab as DrawerTab) : null;
  const openRow = openSku ? (rows.find((row) => row.product.sku === openSku) ?? null) : null;
  const openPanel = (sku: string) => router.replace(`/products?sku=${encodeURIComponent(sku)}`, { scroll: false });
  const openRecord = (product: Product, tab: DrawerTab = "overview") => router.replace(`/products?sku=${encodeURIComponent(product.sku)}&tab=${tab}`, { scroll: false });
  const closeOpen = () => router.replace("/products", { scroll: false });

  const supplierName = (id: number | null | undefined) => (id ? (suppliers?.find((supplier) => supplier.id === id)?.name ?? `Fornecedor ${id}`) : null);
  const scopeLabel = storeId === null ? "Todas as lojas" : (stores?.find((store) => store.id === storeId)?.name ?? `Loja ${storeId}`);

  const globalGroups = useMemo<PendencyGroup[]>(() => {
    const groups: PendencyGroup[] = [];
    if (report) {
      // Só o que impede ou compromete a decisão é pendência. Aproximações e médias que explicam o número ficam em "Detalhes do cálculo".
      for (const note of setupNotes({ report }).filter((item) => !item.informational)) {
        groups.push({ code: `note-${groups.length}`, label: note.text, action: note.action ? "open_rules" : "info", actionLabel: note.action?.label ?? "", href: note.action?.href, skus: [] });
      }
      const incomplete = isClassified(report.meta.operating) ? incompleteSummary(report.meta.operating) : null;
      if (incomplete) groups.push({ code: "unclassified", label: incomplete, action: "open_rules", actionLabel: "Classificar despesas", skus: [] });
    }

    return groups;
  }, [report]);
  const infoNotes = useMemo(() => (report ? setupNotes({ report }).filter((item) => item.informational).map((item) => item.text) : []), [report]);
  const pendencies = useMemo(() => buildPendencyGroups(rows, globalGroups), [rows, globalGroups]);

  /** Relê custo, preço e o cálculo de hoje. */
  function refresh() {
    void pricesQuery.refetch();
    void costsQuery.refetch();
    void currentQuery.refetch();
  }

  function afterPriceSaved() {
    // O preço mudou: a lista relê custo e preço de hoje e refaz o cálculo de hoje.
    refresh();
  }

  function runPendencyAction(group: PendencyGroup) {
    setPendenciesOpen(false);
    if (group.href) return router.push(group.href);
    if (group.action === "recalculate") return refresh();
    if (group.action === "open_rules") return setRulesOpen(true);
    if (group.action === "register_cost") return setFilters({ ...NO_WORKSPACE_FILTERS, quick: "pending" });
    if (group.action === "open_product" && group.skus[0]) openPanel(group.skus[0]);
  }

  async function exportExcel() {
    try {
      const { downloadProductsWorkbook } = await import("@/lib/products/excel");
      downloadProductsWorkbook(visible.map((row) => ({ product: row.product, categoryName: categoryName(row.product.category, categories), costCents: row.cost?.cents ?? null, costDate: row.cost?.from ?? null })));
    } catch (failure) {
      console.error("Exportar produtos falhou", failure);
      toast.error("Não foi possível gerar a planilha.");
    }
  }

  const toggleSort = (key: SortKey) => setSort((previous) => (previous.key === key ? { key, direction: previous.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "name" || key === "situation" || key === "margin" ? "asc" : "desc" }));
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.product.sku));
  const subcategories = useMemo(() => (filters.category === ALL ? [] : (categories?.find((row) => row.key === filters.category)?.subcategories.filter((sub) => sub.status === "active").map((sub) => sub.name) ?? [])), [categories, filters.category]);
  const summary = pendencySummary(pendencies);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">Produtos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cadastre, confira custos e defina preços.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onViewPeriod}>
            <BarChart3 aria-hidden /> Analisar período
          </Button>
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Upload aria-hidden /> Importar <ChevronDown aria-hidden />
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
          {canWrite && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Novo produto
            </Button>
          )}
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onCategories}>
              <FolderTree aria-hidden /> Categorias
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings aria-hidden /> Configurações <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRulesOpen(true)}>Regras de negócio da precificação</DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/treasury/fees">Taxas de pagamento</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={exportExcel} disabled={isLoading || visible.length === 0}>
                  <FileSpreadsheet aria-hidden /> Exportar a lista (Excel)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Input placeholder="Buscar produto, SKU ou EAN…" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} className="h-11 lg:max-w-sm" aria-label="Buscar produto" />
        <Select value={filters.category} onValueChange={(value) => setFilters({ ...filters, category: value, subcategory: ALL })}>
          <SelectTrigger className="h-11 lg:w-56" aria-label="Categoria">
            <SelectValue placeholder="Todas as categorias" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {(categories ?? []).map((row) => (
              <SelectItem key={row.key} value={row.key}>
                {row.name}
                {row.status === "inactive" ? " (inativa)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {subcategories.length > 0 && (
          <Select value={filters.subcategory} onValueChange={(value) => setFilters({ ...filters, subcategory: value })}>
            <SelectTrigger className="h-11 lg:w-48" aria-label="Subcategoria">
              <SelectValue placeholder="Todas as subcategorias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as subcategorias</SelectItem>
              {subcategories.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={storeId === null ? NETWORK : String(storeId)} onValueChange={(value) => setStoreId(value === NETWORK ? null : Number(value))}>
          <SelectTrigger className="h-11 lg:w-56" aria-label="Loja">
            <SelectValue placeholder="Todas as lojas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NETWORK}>Todas as lojas</SelectItem>
            <SelectSeparator />
            {(stores ?? []).map((store) => (
              <SelectItem key={store.id} value={String(store.id)}>
                {store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtros rápidos" className="flex flex-wrap gap-2">
          {(Object.keys(QUICK_FILTER_LABEL) as QuickFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.quick === key}
              onClick={() => setFilters({ ...filters, quick: key })}
              className={cn("flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors", filters.quick === key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {QUICK_FILTER_LABEL[key]}
              <span className={cn("tabular rounded-md px-1.5 py-0.5 text-xs", filters.quick === key ? "bg-primary-foreground/20" : "bg-muted")}>{registryFailed ? "—" : counts[key]}</span>
            </button>
          ))}
        </div>
        {summary && (
          <p className="flex items-center gap-2 text-sm text-warning" data-testid="pendency-summary">
            <TriangleAlert aria-hidden className="size-4" />
            {summary} de dados
            <span aria-hidden className="text-muted-foreground">
              |
            </span>
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => setPendenciesOpen(true)}>
              Revisar
            </button>
          </p>
        )}
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="calculation-caption">
        {calculationFailed ? (
          <>
            <span className="text-destructive">Não foi possível calcular a precificação de hoje: margem e preço sugerido ficam indisponíveis. O que você digitou e a lista continuam.</span>
            <button type="button" className="font-medium underline underline-offset-2" onClick={refresh}>
              Tentar de novo
            </button>
          </>
        ) : report === null ? (
          <span className="flex items-center gap-1.5">
            <RefreshCw aria-hidden className="size-3 animate-spin" /> Calculando a precificação de hoje…
          </span>
        ) : (
          <>
            <span>
              Margem de contribuição e sugestão calculadas hoje, com o custo e o preço de hoje; vendas, perdas e despesas de {formatPeriod(report.meta.months[0])} a {formatPeriod(report.meta.months[report.meta.months.length - 1])}.
            </span>
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => setDetailsOpen(true)}>
              Detalhes do cálculo
            </button>
            <button type="button" className="font-medium underline underline-offset-2" onClick={refresh} disabled={calculating}>
              {calculating ? "Atualizando…" : "Atualizar"}
            </button>
          </>
        )}
        {storeId !== null && <span>Cálculo da loja {scopeLabel}; o preço de venda continua sendo único para a rede.</span>}
      </p>

      {selected.size > 0 && (
        <div role="region" aria-label="Seleção" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm">
          <span>
            <strong>{selected.size}</strong> {selected.size === 1 ? "produto selecionado" : "produtos selecionados"}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => setBatching(true)}>
                Revisar preços em lote
              </Button>
            )}
          </span>
        </div>
      )}

      <RequestState isLoading={isLoading} error={error} onRetry={refetch} isEmpty={false}>
        {registryFailed && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm" data-testid="registry-failed">
            <div>
              <p className="font-medium text-destructive">Não foi possível ler {costsQuery.isError && pricesQuery.isError ? "o custo e o preço" : costsQuery.isError ? "o custo" : "o preço"} de hoje.</p>
              <p className="text-muted-foreground">A lista não mostra custo, preço nem situação enquanto isso, para não parecer que os produtos estão sem preço. Se persistir, o serviço de produtos ou o gateway pode estar desatualizado: reconstrua os contêineres de dev.</p>
            </div>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw aria-hidden /> Tentar de novo
            </Button>
          </div>
        )}
        <div className={cn("max-h-[calc(100vh-22rem)] min-h-64 overflow-auto rounded-lg border", registryFailed && "hidden")}>
          <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm" data-testid="products-table">
            <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
              <tr>
                <th className="w-10 border-b px-3 py-3">
                  <Checkbox
                    aria-label="Selecionar todos os produtos da lista"
                    checked={allVisibleSelected}
                    onCheckedChange={(on) =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        for (const row of visible) {
                          if (on === true) next.add(row.product.sku);
                          else next.delete(row.product.sku);
                        }

                        return next;
                      })
                    }
                  />
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className={cn("border-b px-3 py-3 font-medium", column.align === "right" ? "text-right" : "text-left")} aria-sort={sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => toggleSort(column.key)} className="inline-flex flex-col items-end whitespace-nowrap text-left font-medium hover:text-foreground">
                      <span>
                        {column.label}
                        {sort.key === column.key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
                      </span>
                      {column.sub && <span className="text-[0.65rem] font-normal">{column.sub}</span>}
                    </button>
                  </th>
                ))}
                <th className="w-40 border-b px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading || costsQuery.isLoading || pricesQuery.isLoading
                ? Array.from({ length: 8 }).map((_, index) => (
                    <tr key={index}>
                      {Array.from({ length: 8 }).map((__, cell) => (
                        <td key={cell} className="border-b px-3 py-4">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                : visible.map((row) => (
                    <ProductRow
                      key={row.product.sku}
                      row={row}
                      categories={categories}
                      checked={selected.has(row.product.sku)}
                      canWrite={canWrite}
                      onCheck={(on) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (on) next.add(row.product.sku);
                          else next.delete(row.product.sku);

                          return next;
                        })
                      }
                      onReview={() => openPanel(row.product.sku)}
                      onRecord={() => openRecord(row.product)}
                      onEdit={() => setEditing(row.product)}
                    />
                  ))}
              {!isLoading && !costsQuery.isLoading && !pricesQuery.isLoading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    {rows.length === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto com esses filtros."}{" "}
                    {rows.length > 0 && (
                      <button type="button" className="font-medium underline underline-offset-2" onClick={() => setFilters(NO_WORKSPACE_FILTERS)}>
                        Limpar filtros
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Mostrando {visible.length} de {rows.length} produtos.
        </p>
      </RequestState>

      {creating && <NewProductPanel open onOpenChange={setCreating} onCreated={() => undefined} />}
      {importing && <CatalogueImportDialog open onOpenChange={setImporting} />}
      {rulesOpen && <RulesDialog open onOpenChange={setRulesOpen} categories={(categories ?? []).map((row) => ({ key: row.key, label: row.name }))} canEdit={canWrite} operating={report?.meta.operating ?? null} />}
      {pendenciesOpen && <PendenciesDialog groups={pendencies} rows={rows} onClose={() => setPendenciesOpen(false)} onAction={runPendencyAction} onOpenProduct={(sku) => (setPendenciesOpen(false), openPanel(sku))} />}
      {batching && (
        <BatchReviewDialog
          rows={selectedRows}
          onClose={() => setBatching(false)}
          onSaved={() => {
            setSelected(new Set());
            afterPriceSaved();
          }}
        />
      )}
      {detailsOpen && report && (
        <Dialog open onOpenChange={setDetailsOpen}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Detalhes do cálculo</DialogTitle>
              <DialogDescription>Versão do motor e das regras, período, bases e a métrica com que a margem foi calculada.</DialogDescription>
            </DialogHeader>
            <CalculationSheet report={report} run={null} history={[]} viewingOlder={false} onView={() => undefined} />
            {infoNotes.length > 0 && (
              <section aria-label="Como o número foi construído" className="flex flex-col gap-1 text-xs text-muted-foreground">
                <h3 className="text-sm font-semibold text-foreground">Como o número foi construído</h3>
                <ul className="list-disc pl-5">
                  {infoNotes.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </section>
            )}
            <Button variant="outline" size="sm" className="self-start" onClick={() => (setDetailsOpen(false), onViewPeriod())}>
              Abrir a análise do período
            </Button>
          </DialogContent>
        </Dialog>
      )}

      {openRow && recordTab === null && (
        <PriceReviewPanel
          row={openRow}
          scope={{ storeId, report, computedAt: currentQuery.fulfilledTimeStamp ? new Date(currentQuery.fulfilledTimeStamp).toISOString() : null }}
          canWrite={canWrite}
          onClose={closeOpen}
          onSaved={afterPriceSaved}
          onEdit={setEditing}
          onOpenRecord={(product) => openRecord(product)}
        />
      )}
      {openRow && recordTab !== null && <ProductDrawer product={openRow.product} supplierName={supplierName} tab={recordTab} onTabChange={(next) => openRecord(openRow.product, next)} onClose={closeOpen} canWrite={canWrite} onEdit={() => setEditing(openRow.product)} />}
      {editing && <EditProductDialog key={editing.id} product={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProductRow({ row, categories, checked, canWrite, onCheck, onReview, onRecord, onEdit }: { row: WorkspaceRow; categories: ReturnType<typeof useGetCategoriesQuery>["data"]; checked: boolean; canWrite: boolean; onCheck: (on: boolean) => void; onReview: () => void; onRecord: () => void; onEdit: () => void }) {
  const { product } = row;
  const below = isBelowTarget(row);

  return (
    <tr className={cn("group cursor-pointer hover:bg-muted/40", checked && "bg-primary/5")} onClick={onReview} data-testid="product-row">
      <td className="border-b px-3 py-3" onClick={(event) => event.stopPropagation()}>
        <Checkbox aria-label={`Selecionar ${product.name}`} checked={checked} onCheckedChange={(on) => onCheck(on === true)} />
      </td>
      <td className="border-b px-3 py-3">
        <span className="block font-medium">{product.name}</span>
        <span className="block text-xs text-muted-foreground">
          SKU {product.sku} · {categoryName(product.category, categories)}
          {product.subcategory ? ` / ${product.subcategory}` : ""}
          {product.origin?.type === "invoice" && " · cadastrado por NF-e"}
        </span>
      </td>
      <td className="tabular border-b px-3 py-3 text-right">{row.cost ? money(row.cost.cents) : <span className="text-muted-foreground">Sem custo</span>}</td>
      <td className="tabular border-b px-3 py-3 text-right font-medium">{row.price ? money(row.price.cents) : <span className="font-normal text-muted-foreground">Não definido</span>}</td>
      <td className="tabular border-b px-3 py-3 text-right">
        {row.suggestedCents !== null ? <span className="rounded-md bg-primary/10 px-2 py-1 font-semibold text-primary">{money(row.suggestedCents)}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className={cn("tabular border-b px-3 py-3 text-right", below ? "text-warning" : row.margin !== null ? "text-foreground" : "text-muted-foreground")}>{row.margin !== null ? percent(row.margin) : "—"}</td>
      <td className="border-b px-3 py-3">
        <StatusBadge tone={SITUATION_TONE[row.situation]} className="whitespace-nowrap">
          {SITUATION_LABEL[row.situation]}
        </StatusBadge>
      </td>
      <td className="border-b px-3 py-3 text-right" onClick={(event) => event.stopPropagation()}>
        <span className="inline-flex items-center gap-1">
          <Button variant="link" size="sm" onClick={onReview} aria-label={`Revisar ${product.name}`}>
            Revisar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Mais ações de ${product.name}`}>
                <MoreVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onReview}>Revisar preço</DropdownMenuItem>
              <DropdownMenuItem onSelect={onRecord}>Abrir cadastro completo</DropdownMenuItem>
              {canWrite && <DropdownMenuItem onSelect={onEdit}>Editar cadastro</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </td>
    </tr>
  );
}
