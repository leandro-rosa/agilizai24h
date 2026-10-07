"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetCategoriesQuery, useGetProductCostsQuery, useGetProductMarginsQuery, useGetProductPricesQuery, useGetProductTimelineQuery, type Product } from "@/lib/api/products";
import { formatCents } from "@/lib/purchases/money";
import { costNumbers, lastClosedMonth } from "@/lib/products/cost-metrics";
import { SOURCE_LABEL, STATUS_LABEL, isoDay, originText } from "@/lib/products/labels";
import { categoryName } from "@/lib/products/taxonomy";
import { EanSection } from "./ean-section";
import { ProductMarginTab } from "./product-margin-tab";
import { ProductPurchasesTab } from "./product-purchases-tab";
import { ManualVersionDialog } from "./manual-version-dialog";

export type DrawerTab = "overview" | "costs" | "prices" | "history" | "purchases" | "margin";
export const DRAWER_TABS: DrawerTab[] = ["overview", "costs", "prices", "history", "purchases", "margin"];

const today = () => new Date().toISOString().slice(0, 10);
const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1).replace(".", ",")}%`);
const money = (cents: number | null) => (cents === null ? "—" : formatCents(cents));
const empty = (text: string) => <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{text}</p>;

/**
 * O produto inteiro num painel lateral, sem sair da lista: visão geral (identificação, origem e EANs), custos, preços e histórico. Tudo aqui é leitura
 * do que o products-service guarda; nada é recalculado no navegador além de rótulos e da média ponderada das compras (rotulada MÉTRICA DERIVADA).
 */
export function ProductDrawer({
  product,
  supplierName,
  tab,
  onTabChange,
  onClose,
  canWrite,
  onEdit,
}: {
  product: Product;
  supplierName: (id: number | null | undefined) => string | null;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const categories = useGetCategoriesQuery().data;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{product.name}</SheetTitle>
          <SheetDescription>
            SKU {product.sku} · {categoryName(product.category, categories)}
            {product.status && product.status !== "active" ? ` · ${STATUS_LABEL[product.status] ?? product.status}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <Tabs value={tab} onValueChange={(value) => onTabChange(value as DrawerTab)}>
            <TabsList>
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              <TabsTrigger value="costs">Custos</TabsTrigger>
              <TabsTrigger value="prices">Preços</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
              <TabsTrigger value="purchases">Compras</TabsTrigger>
              <TabsTrigger value="margin">Margem</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <OverviewTab product={product} supplierName={supplierName} canWrite={canWrite} onEdit={onEdit} />
            </TabsContent>
            <TabsContent value="costs" className="mt-4">
              <CostsTab product={product} supplierName={supplierName} canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="prices" className="mt-4">
              <PricesTab product={product} canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <HistoryTab product={product} supplierName={supplierName} />
            </TabsContent>
            <TabsContent value="purchases" className="mt-4">
              <ProductPurchasesTab product={product} supplierName={supplierName} />
            </TabsContent>
            <TabsContent value="margin" className="mt-4">
              <ProductMarginTab product={product} />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function OverviewTab({ product, supplierName, canWrite, onEdit }: { product: Product; supplierName: (id: number | null | undefined) => string | null; canWrite: boolean; onEdit: () => void }) {
  const categories = useGetCategoriesQuery().data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Identificação</h3>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/products?view=pricing&sku=${encodeURIComponent(product.sku)}`}>Abrir na Precificação</Link>
            </Button>
            {canWrite && (
              <Button size="sm" variant="outline" onClick={onEdit}>
                Editar
              </Button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Código interno (SKU)">
            <span className="font-mono">{product.sku}</span>
          </Field>
          <Field label="Categoria">{categoryName(product.category, categories)}</Field>
          <Field label="Subcategoria">{product.subcategory ?? "—"}</Field>
          <Field label="Marca">{product.brand ?? "—"}</Field>
          <Field label="Unidade de venda">{product.sale_unit ?? "un"}</Field>
          <Field label="Unidade de compra">{product.purchase_unit ?? "—"}</Field>
          <Field label="Fator caixa/fardo → unidade">{product.units_per_package ? `${product.units_per_package} un. por ${product.package_type ?? "embalagem"}${product.fractionable ? " (fracionável)" : ""}` : "—"}</Field>
          <Field label="Situação">{STATUS_LABEL[product.status ?? "active"] ?? product.status}</Field>
          <Field label="Fornecedor">{supplierName(product.supplier_id) ?? "Sem fornecedor vinculado"}</Field>
        </dl>
        <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="origin">
          {originText(product.origin)}
        </p>
      </section>
      <EanSection product={product} canWrite={canWrite} />
    </div>
  );
}

function CostsTab({ product, supplierName, canWrite }: { product: Product; supplierName: (id: number | null | undefined) => string | null; canWrite: boolean }) {
  const query = useGetProductCostsQuery(product.id);
  const [adding, setAdding] = useState(false);
  const versions = useMemo(() => query.data ?? [], [query.data]);
  const numbers = useMemo(() => costNumbers(versions, today(), lastClosedMonth(today())), [versions]);
  const ordered = useMemo(() => [...versions].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id), [versions]);
  const first = versions.length ? versions.map((v) => v.effective_from.slice(0, 10)).sort()[0] : null;

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Carregando custos…</p>;
  if (query.isError) return <p className="text-sm text-destructive">Não foi possível carregar os custos.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Custos</h3>
          {first && <p className="text-xs text-muted-foreground">Histórico disponível a partir de {isoDay(first)}. Nada é afirmado antes disso.</p>}
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setAdding(true)}>
            Novo custo
          </Button>
        )}
      </div>

      {versions.length === 0 ? (
        empty("Este produto ainda não tem custo. Ele nasce da primeira compra recebida, ou pode ser digitado à mão com um motivo.")
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-3">
            <Field label="Custo vigente (o que a Precificação usa)">
              {numbers.inForce ? (
                <>
                  <strong>{formatCents(numbers.inForce.cost_cents)}</strong>
                  <span className="block text-xs text-muted-foreground">
                    desde {isoDay(numbers.inForce.effective_from)} · {SOURCE_LABEL[numbers.inForce.source]}
                  </span>
                </>
              ) : (
                "Sem custo hoje"
              )}
            </Field>
            <Field label="Último custo de compra">
              {numbers.lastPurchase ? (
                <>
                  <strong>{formatCents(numbers.lastPurchase.cost_cents)}</strong>
                  <span className="block text-xs text-muted-foreground">
                    NF {numbers.lastPurchase.invoice_number ?? "—"} em {isoDay(numbers.lastPurchase.effective_from)}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Sem compra registrada</span>
              )}
            </Field>
            <Field label="Custo médio das compras">
              {numbers.weightedPurchase ? (
                <>
                  <strong>{formatCents(numbers.weightedPurchase.centsPerUnit)}</strong>
                  <span className="block text-xs text-muted-foreground">
                    MÉTRICA DERIVADA: total pago ÷ {numbers.weightedPurchase.units} un. em {numbers.weightedPurchase.purchases} {numbers.weightedPurchase.purchases === 1 ? "compra" : "compras"}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Sem compra com quantidade e total</span>
              )}
            </Field>
            <Field label={`Custo usado no CMV de ${numbers.forCmv.month.slice(5)}/${numbers.forCmv.month.slice(0, 4)}`}>
              {numbers.forCmv.version ? (
                <>
                  <strong>{formatCents(numbers.forCmv.version.cost_cents)}</strong>
                  <span className="block text-xs text-muted-foreground">o vigente no último dia do mês (regra do financeiro)</span>
                </>
              ) : (
                <span className="text-muted-foreground">Sem custo naquele mês</span>
              )}
            </Field>
          </dl>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vigência</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Fornecedor / nota</TableHead>
                <TableHead>Compra</TableHead>
                <TableHead>Usuário e motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((v) => (
                <TableRow key={v.id} className={v.superseded ? "opacity-60" : undefined}>
                  <TableCell className="tabular">
                    {isoDay(v.effective_from)} → {v.valid_to ? isoDay(v.valid_to) : v.superseded ? "—" : "vigente"}
                    {v.superseded && <StatusBadge tone="neutral">Substituído</StatusBadge>}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">{formatCents(v.cost_cents)}</TableCell>
                  <TableCell>{SOURCE_LABEL[v.source]}</TableCell>
                  <TableCell className="whitespace-normal text-xs">
                    {supplierName(v.supplier_id) ?? "—"}
                    {v.invoice_number && (
                      <span className="block">
                        {v.purchase_id ? (
                          <Link className="underline" href={`/purchases/invoices?purchase=${v.purchase_id}`}>
                            NF {v.invoice_number}
                          </Link>
                        ) : (
                          `NF ${v.invoice_number}`
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs">
                    {v.purchase_quantity && v.purchase_total_cents ? `${v.purchase_quantity} un. por ${formatCents(v.purchase_total_cents)}` : "—"}
                    {v.pack_quantity && v.units_per_pack ? <span className="block text-muted-foreground">{v.pack_quantity} emb. de {v.units_per_pack} un.</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs">
                    {v.actor ?? "—"}
                    {v.reason && <span className="block text-muted-foreground">{v.reason}</span>}
                    <span className="block text-muted-foreground">registrado em {isoDay(v.created_at)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {adding && <ManualVersionDialog kind="cost" sku={product.sku} name={product.name} open onOpenChange={setAdding} />}
    </div>
  );
}

function PricesTab({ product, canWrite }: { product: Product; canWrite: boolean }) {
  const prices = useGetProductPricesQuery(product.id);
  const margins = useGetProductMarginsQuery(product.id);
  const [adding, setAdding] = useState(false);
  const versions = useMemo(() => prices.data ?? [], [prices.data]);
  const ordered = useMemo(() => [...versions].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id), [versions]);
  const intervals = useMemo(() => [...(margins.data?.intervals ?? [])].reverse(), [margins.data]);

  if (prices.isLoading) return <p className="text-sm text-muted-foreground">Carregando preços…</p>;
  if (prices.isError) return <p className="text-sm text-destructive">Não foi possível carregar os preços.</p>;
  const current = ordered.find((v) => !v.superseded && v.effective_from.slice(0, 10) <= today());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Preços</h3>
          {current ? (
            <p className="text-sm">
              Preço vigente: <strong>{formatCents(current.price_cents)}</strong> desde {isoDay(current.effective_from)} · {SOURCE_LABEL[current.source]}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Sem preço vigente.</p>
          )}
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setAdding(true)}>
            Novo preço
          </Button>
        )}
      </div>

      {versions.length === 0 ? (
        empty("Este produto ainda não tem preço de venda. A Precificação Inteligente pode sugerir um.")
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vigência</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Usuário e motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((v) => (
              <TableRow key={v.id} className={v.superseded ? "opacity-60" : undefined}>
                <TableCell className="tabular">
                  {isoDay(v.effective_from)} → {v.valid_to ? isoDay(v.valid_to) : v.superseded ? "—" : "vigente"}
                  {v.superseded && <StatusBadge tone="neutral">Substituído</StatusBadge>}
                </TableCell>
                <TableCell className="tabular text-right font-medium">{formatCents(v.price_cents)}</TableCell>
                <TableCell>{SOURCE_LABEL[v.source]}</TableCell>
                <TableCell className="whitespace-normal text-xs">
                  {v.actor ?? "—"}
                  {v.reason && <span className="block text-muted-foreground">{v.reason}</span>}
                  {v.source === "pricing_intelligence" && v.source_ref && <span className="block text-muted-foreground">decisão {v.source_ref.slice(0, 8)}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Margem de cada período</h3>
        <p className="text-xs text-muted-foreground">Cada período usa o preço e o custo que valiam na data em que ele começou: uma mudança de hoje nunca altera um período antigo.</p>
        {margins.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando margens…</p>
        ) : intervals.length === 0 ? (
          empty("Sem períodos para calcular.")
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Markup</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {intervals.map((i) => (
                <TableRow key={i.from}>
                  <TableCell className="tabular">
                    {isoDay(i.from)} → {i.to ? isoDay(i.to) : "hoje"}
                  </TableCell>
                  <TableCell className="tabular text-right">{money(i.price_cents)}</TableCell>
                  <TableCell className="tabular text-right">{money(i.cost_cents)}</TableCell>
                  <TableCell className="tabular text-right font-medium">{pct(i.margin)}</TableCell>
                  <TableCell className="tabular text-right">{i.markup === null ? "—" : `${i.markup.toFixed(2).replace(".", ",")}×`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {adding && <ManualVersionDialog kind="price" sku={product.sku} name={product.name} open onOpenChange={setAdding} />}
    </div>
  );
}

function HistoryTab({ product, supplierName }: { product: Product; supplierName: (id: number | null | undefined) => string | null }) {
  const query = useGetProductTimelineQuery(product.id);

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Carregando histórico…</p>;
  if (query.isError || !query.data) return <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>;
  const { events, history_available_from: from } = query.data;
  if (events.length === 0) return empty("Ainda não houve nenhuma alteração de custo ou de preço.");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Histórico disponível a partir de {from ? isoDay(from) : "—"}. Do mais recente para o mais antigo.</p>
      <ol className="flex flex-col gap-2">
        {events.map((event, index) => (
          <li key={`${event.kind}-${event.date}-${index}`} className={`rounded-md border p-3 text-sm ${event.superseded ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <strong>{isoDay(event.date)}</strong>
              <span>{event.kind === "cost" ? "Custo" : "Preço"}</span>
              <span className="tabular">
                {event.previous_value_cents === null ? "primeira versão" : formatCents(event.previous_value_cents)} → <strong>{formatCents(event.value_cents)}</strong>
              </span>
              {event.superseded && <StatusBadge tone="neutral">Substituído</StatusBadge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABEL[event.source]}
              {event.actor ? ` · ${event.actor}` : ""}
              {event.invoice_number ? ` · NF ${event.invoice_number}` : ""}
              {supplierName(event.supplier_id) ? ` · ${supplierName(event.supplier_id)}` : ""}
              {event.reason ? ` · ${event.reason}` : ""}
              {` · registrado em ${isoDay(event.recorded_at)}`}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
