"use client";

import { newUuid } from "@/lib/uuid";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { IncreaseCapNotice, ValidationNotice } from "@/components/pricing/cap-notice";
import { CostSources } from "@/components/pricing/cost-sources";
import { CalculationDetails, StoresView } from "@/components/pricing/product-drawer";
import { StructureTable } from "@/components/pricing/structure-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useGetCurrentProductStoresQuery, type PricingReport } from "@/lib/api/pricing";
import { useGetProductTimelineQuery, type Product } from "@/lib/api/products";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import { date, money } from "@/lib/format";
import { costOriginText, percent } from "@/lib/pricing/labels";
import { hasValidPrice } from "@/lib/products/suggestion";
import { categoryName } from "@/lib/products/taxonomy";
import { usePriceProjection } from "@/lib/products/use-price-projection";
import { usePriceSaver } from "@/lib/products/use-price-saver";
import { SITUATION_LABEL, type Situation, type WorkspaceRow } from "@/lib/products/workspace";
import { parseMoneyToCents } from "@/lib/purchases/money";
import { useGetCategoriesQuery } from "@/lib/api/products";
import { Expandable, MoneyField } from "./money-field";
import { SuggestionNotice } from "./new-product-panel";

const today = () => new Date().toISOString().slice(0, 10);
const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const dayText = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export const SITUATION_TONE: Record<Situation, "positive" | "attention" | "neutral" | "critical"> = { healthy: "positive", review: "attention", opportunity: "neutral", pending: "neutral", stale: "attention", no_price: "neutral" };

/** O cálculo de HOJE em que o painel se apoia: o relatório da base atual, a loja do escopo e o instante em que foi calculado. */
export interface PanelScope {
  storeId: number | null;
  /** O nome da loja do escopo, para dizer de onde vem uma perda de loja. */
  storeName?: string | null;
  report: PricingReport | null;
  computedAt: string | null;
}

/**
 * O painel de decisão de preço de UM produto (o "Revisar preço"): identificação, custo com origem e data, preço atual, preço sugerido, o preço escolhido
 * com a margem de contribuição e a contribuição por unidade resultantes, e a ação de salvar. O resto (composição do cálculo, cadastro e EANs, compra e
 * embalagem, histórico, preços por loja, resultado após rateio) fica em seções recolhidas. Digitar um preço atualiza a margem e nunca é sobrescrito por
 * uma nova sugestão. Salvar mostra o escopo e a vigência antes de confirmar.
 */
export function PriceReviewPanel({ row, scope, canWrite, onClose, onSaved, onEdit, onOpenRecord }: { row: WorkspaceRow; scope: PanelScope; canWrite: boolean; onClose: () => void; onSaved: () => void; onEdit: (product: Product) => void; onOpenRecord: (product: Product) => void }) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {/* Remontado por produto: trocar de produto não herda o preço digitado do anterior. */}
        <PanelBody key={row.product.sku} row={row} scope={scope} canWrite={canWrite} onClose={onClose} onSaved={onSaved} onEdit={onEdit} onOpenRecord={onOpenRecord} />
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({ row, scope, canWrite, onClose, onSaved, onEdit, onOpenRecord }: { row: WorkspaceRow; scope: PanelScope; canWrite: boolean; onClose: () => void; onSaved: () => void; onEdit: (product: Product) => void; onOpenRecord: (product: Product) => void }) {
  const { product } = row;
  const categories = useGetCategoriesQuery().data;
  const supplierName = useGetSuppliersQuery().data?.find((supplier) => supplier.id === product.supplier_id)?.name ?? null;
  const save = usePriceSaver();

  // `null` = o preço escolhido acompanha a sugestão; um texto = a pessoa digitou o dela e nenhuma sugestão nova o sobrescreve.
  const [priceText, setPriceText] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [validFrom, setValidFrom] = useState(today());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [key] = useState(() => newUuid());

  const typedCents = priceText === null ? null : parseMoneyToCents(priceText);
  const projection = usePriceProjection(row, scope, typedCents);
  const following = priceText === null;
  const chosenCents = following ? projection.suggestedCents : typedCents;
  const differs = !following && chosenCents !== projection.suggestedCents;
  const unchanged = hasValidPrice(chosenCents) && row.price !== null && chosenCents === row.price.cents;
  // Enquanto a margem do preço escolhido não chega, o que está na tela é o da entrada anterior: não se salva nesse intervalo.
  const canSave = canWrite && hasValidPrice(chosenCents) && !unchanged && (!differs || reason.trim() !== "") && row.cost !== null && !saving && !projection.loading;
  const currentMargin = row.margin;

  async function confirm() {
    if (!hasValidPrice(chosenCents)) return;
    setSaving(true);
    setFailure(null);
    const result = await save({ row, mode: projection.mode, priceCents: chosenCents, following, reason, effectiveFrom: validFrom, key });
    setSaving(false);
    if (!result.ok) return setFailure(result.message);
    if (result.warning) toast.warning(result.warning);
    else toast.success(`Preço de ${product.name} alterado para ${money(chosenCents)} a partir de ${dayText(validFrom)}.`);
    setConfirming(false);
    onSaved();
    onClose();
  }

  return (
    <>
      <SheetHeader className="px-6 pt-6">
        <div className="flex items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <SheetTitle className="text-2xl">Revisar preço</SheetTitle>
            <SheetDescription className="mt-1">
              <span className="font-medium text-foreground">{product.name}</span>
              <span className="block text-xs">
                SKU {product.sku} · {categoryName(product.category, categories)}
                {product.subcategory ? ` / ${product.subcategory}` : ""}
              </span>
            </SheetDescription>
          </div>
          <StatusBadge tone={SITUATION_TONE[row.situation]}>{SITUATION_LABEL[row.situation]}</StatusBadge>
        </div>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
        {row.pending.length > 0 && (
          <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="panel-pending">
            <p className="font-medium">O que afeta esta decisão</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {row.pending.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}

        {row.analysis?.increaseCap && <IncreaseCapNotice cap={row.analysis.increaseCap} />}
        {row.analysis && <ValidationNotice product={row.analysis} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground">Custo da mercadoria (por unidade)</p>
            {row.cost ? (
              <>
                <p className="tabular text-2xl font-semibold">{money(row.cost.cents)}</p>
                <p className="text-xs text-muted-foreground">{costOriginText(row.costOrigin) ?? `Desde ${dayText(row.cost.from)}`}</p>
              </>
            ) : (
              <p className="text-base font-medium text-muted-foreground">Sem custo cadastrado</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Preço atual</p>
              <p className="tabular text-xl font-semibold">{row.price ? money(row.price.cents) : "Não definido"}</p>
              {row.price && <p className="text-xs text-muted-foreground">desde {dayText(row.price.from)}</p>}
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Preço sugerido</p>
              <p className="tabular text-xl font-semibold">{projection.suggestedCents !== null ? money(projection.suggestedCents) : "—"}</p>
              <p className="text-xs text-muted-foreground">{projection.mode === "calculation" ? "cálculo de hoje" : "sugestão inicial"}</p>
              {row.analysis?.minimumPriceCents ? (
                <p className="text-xs text-muted-foreground" title="Preço necessário para atingir a margem mínima">
                  Piso {money(row.analysis.minimumPriceCents)} · margem mínima {percent(row.analysis.minimumMargin, 0)}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <SuggestionNotice view={projection.view} onRetry={projection.retry} />

        <section aria-label="Decisão do preço" className="flex flex-col gap-3">
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <MoneyField
              label="Novo preço de venda"
              value={following ? (projection.suggestedCents !== null ? reais(projection.suggestedCents) : "") : (priceText ?? "")}
              onChange={setPriceText}
              placeholder={projection.suggestedCents === null ? "Digite um preço" : undefined}
              error={!following && priceText !== "" && typedCents === null ? "Informe um preço válido, maior que zero." : null}
              hint={unchanged ? "É o preço atual: nada a alterar." : following ? "Acompanha a sugestão até você digitar outro." : undefined}
            />
            {!following && projection.suggestedCents !== null && (
              <Button type="button" variant="outline" className="h-11" onClick={() => setPriceText(null)}>
                Usar o sugerido ({money(projection.suggestedCents)})
              </Button>
            )}
          </div>
          {differs && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span className="text-muted-foreground">Motivo do preço escolhido (obrigatório)</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Motivo do preço escolhido" className="h-11" placeholder="Por que este preço, e não o sugerido?" />
            </label>
          )}

          <div className={`grid grid-cols-2 gap-4 rounded-lg border p-4 ${projection.loading ? "opacity-50 transition-opacity" : ""}`} aria-busy={projection.loading}>
            <div>
              <p className="text-xs text-muted-foreground">Margem de contribuição estimada</p>
              <p className="tabular text-2xl font-semibold" data-testid="panel-margin">
                {projection.loading ? "Calculando…" : projection.margin !== null ? percent(projection.margin) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {projection.targetMargin !== null ? `Meta ${percent(projection.targetMargin, 0)}` : ""}
                {currentMargin !== null ? ` · hoje ${percent(currentMargin)}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Contribuição por unidade</p>
              <p className="tabular text-2xl font-semibold">{projection.contributionCents !== null ? money(projection.contributionCents) : "—"}</p>
              <p className="text-right text-xs text-muted-foreground">{projection.loading ? <RefreshCw aria-hidden className="ml-auto size-3 animate-spin" /> : "Simulação ilustrativa"}</p>
            </div>
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium sm:w-56">
            <span className="text-muted-foreground">Vigência a partir de</span>
            <Input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} aria-label="Vigência a partir de" className="h-11 text-base" />
          </label>
          <p className="text-xs text-muted-foreground">Escopo: todas as lojas. O cadastro guarda um preço único para a rede, não um por loja. Aprovar registra você, a data e o preço anterior; não publica nada no PDV.</p>
        </section>

        {projection.structure && (
          <Expandable title="De onde vêm a perda e as taxas" defaultOpen>
            <CostSources structure={projection.structure} names={{ product: product.name, category: categoryName(product.category, categories), store: scope.storeName ?? null }} newProduct={projection.mode === "initial"} />
            {projection.mode === "initial" && (
              <p className="text-xs text-muted-foreground">
                <StatusBadge tone="attention">Sugestão inicial · confiança baixa</StatusBadge> Sem histórico de vendas do produto, a sugestão se apoia só na estrutura de custos.
              </p>
            )}
          </Expandable>
        )}

        <Expandable title="Composição do cálculo">
          {row.analysis && scope.report ? (
            <>
            <StructureTable product={row.analysis} />
            <CalculationDetails
              product={row.analysis}
              run={{ parameterVersion: scope.report.meta.parameterVersion, computedAt: scope.computedAt }}
              scope={{ period: scope.report.meta.months[scope.report.meta.months.length - 1] ?? "", storeId: scope.storeId, basis: "current", asOf: scope.report.meta.asOf }}
            />
            </>
          ) : (
            <p className="text-muted-foreground">Sem cálculo guardado em dia para este produto: a sugestão é a inicial do motor, calculada com o custo de hoje. Recalcule a precificação para ver a composição completa.</p>
          )}
        </Expandable>

        <Expandable title="Cadastro e códigos de barras">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Info label="Marca" value={product.brand} />
            <Info label="Peso ou volume" value={product.net_weight} />
            <Info label="Unidade de venda" value={product.sale_unit ?? "un"} />
            <Info label="Fornecedor" value={supplierName} />
          </dl>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Códigos de barras</p>
            {(product.eans ?? []).length === 0 ? (
              <p className="text-muted-foreground">Nenhum EAN cadastrado.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {(product.eans ?? []).map((ean) => (
                  <li key={ean.id} className="flex items-center gap-2">
                    <span className="tabular">{ean.ean}</span>
                    {ean.is_primary && <StatusBadge tone="positive">Principal</StatusBadge>}
                    {ean.status === "inactive" && <StatusBadge tone="neutral">Inativo</StatusBadge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <Button type="button" variant="outline" size="sm" onClick={() => onEdit(product)}>
                Editar cadastro
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenRecord(product)}>
              Abrir cadastro completo (EANs, custos, compras)
            </Button>
          </div>
        </Expandable>

        <Expandable title="Compra e embalagem">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Info label="Unidade de compra" value={product.purchase_unit} />
            <Info label="Tipo de embalagem" value={product.package_type} />
            <Info label="Unidades por embalagem" value={product.units_per_package ? String(product.units_per_package) : null} />
          </dl>
          <p className="text-xs text-muted-foreground">O custo é sempre guardado por unidade vendida: o custo da embalagem dividido pelas unidades dela.</p>
          <Link className="text-sm font-medium underline underline-offset-2" href={`/purchases/invoices?sku=${encodeURIComponent(product.sku)}`}>
            Ver compras deste produto
          </Link>
        </Expandable>

        <LazyExpandable title="Histórico de custos e preços">
          <History productId={product.id} />
        </LazyExpandable>

        <LazyExpandable title="Preços por loja">
          <p className="text-muted-foreground">O preço é único para a rede. Abaixo, a margem estimada e o volume de cada loja (taxas e rateio da rede), com o custo e o preço de hoje.</p>
          <CurrentStores sku={product.sku} />
        </LazyExpandable>

        <Expandable title="Resultado estimado após rateio">
          {row.analysis?.estimatedResultAfterAllocation ? (
            <>
              <p>
                <strong className="tabular">{percent(row.analysis.estimatedResultAfterAllocation.margin)}</strong> do preço, ou {money(Math.round(row.analysis.estimatedResultAfterAllocation.centsPerUnit))} por unidade.
              </p>
              <p className="text-xs text-muted-foreground">Estimativa complementar: {row.analysis.estimatedResultAfterAllocation.criterion}. Não é lucro líquido.</p>
            </>
          ) : (
            <p className="text-muted-foreground">Indisponível sem um cálculo guardado em dia para este produto.</p>
          )}
        </Expandable>

        {failure && (
          <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
            {failure}
          </p>
        )}
      </div>

      <SheetFooter className="flex-row justify-end gap-3 border-t px-6 py-4">
        <Button variant="outline" className="mr-auto h-11" onClick={onClose}>
          Cancelar
        </Button>
        {canWrite ? (
          <Button
            className="h-11"
            disabled={!canSave}
            onClick={() => setConfirming(true)}
            title={row.cost === null ? "Cadastre o custo antes de definir o preço" : !hasValidPrice(chosenCents) ? "Sem preço válido para salvar" : undefined}
          >
            Salvar preço
          </Button>
        ) : (
          <p className="self-center text-xs text-muted-foreground">Você pode ver, mas não alterar preços.</p>
        )}
      </SheetFooter>

      <Dialog open={confirming} onOpenChange={(open) => !saving && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar novo preço</DialogTitle>
            <DialogDescription>Confira o escopo e a vigência antes de salvar.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Produto</dt>
            <dd className="font-medium">
              {product.name} <span className="text-xs text-muted-foreground">SKU {product.sku}</span>
            </dd>
            <dt className="text-muted-foreground">Escopo</dt>
            <dd>Todas as lojas (o preço é único para a rede)</dd>
            <dt className="text-muted-foreground">Preço</dt>
            <dd className="tabular">
              {row.price ? money(row.price.cents) : "Não definido"} → <strong>{hasValidPrice(chosenCents) ? money(chosenCents) : "—"}</strong>
            </dd>
            <dt className="text-muted-foreground">Vigência</dt>
            <dd>a partir de {dayText(validFrom)}</dd>
            <dt className="text-muted-foreground">Margem</dt>
            <dd className="tabular">{projection.margin !== null ? percent(projection.margin) : "—"} de contribuição</dd>
            {differs && (
              <>
                <dt className="text-muted-foreground">Motivo</dt>
                <dd>{reason}</dd>
              </>
            )}
          </dl>
          <p className="text-xs text-muted-foreground">Fica registrado quem aprovou, quando e o preço anterior. Isto não publica o preço no PDV.</p>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={saving}>
              Voltar
            </Button>
            <Button onClick={confirm} disabled={saving}>
              {saving ? "Salvando…" : "Confirmar e salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Margem e volume por loja, sobre a base de hoje do produto. */
function CurrentStores({ sku }: { sku: string }) {
  const { data, isLoading, error, refetch } = useGetCurrentProductStoresQuery(sku);

  return <StoresView data={data} isLoading={isLoading} error={error} onRetry={refetch} />;
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value && value.trim() !== "" ? value : "—"}</dd>
    </div>
  );
}

/** Uma seção recolhida cujo conteúdo só é buscado quando ela é aberta: abrir o painel não dispara histórico e lojas de todos os produtos. */
function LazyExpandable({ title, children }: { title: string; children: React.ReactNode }) {
  const [opened, setOpened] = useState(false);

  return (
    <details className="group rounded-lg border [&_summary::-webkit-details-marker]:hidden" onToggle={(event) => event.currentTarget.open && setOpened(true)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium hover:bg-muted/50">
        {title}
        <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm">{opened ? children : null}</div>
    </details>
  );
}

/** Custo e preço ao longo do tempo, num só histórico: nada é apagado e o preço anterior continua visível. */
function History({ productId }: { productId: number }) {
  const { data, isLoading, error } = useGetProductTimelineQuery(productId);
  const events = useMemo(() => [...(data?.events ?? [])].sort((a, b) => (a.date === b.date ? b.recorded_at.localeCompare(a.recorded_at) : b.date.localeCompare(a.date))), [data]);

  if (isLoading) return <p className="text-muted-foreground">Carregando…</p>;
  if (error) return <p className="text-destructive">Não foi possível carregar o histórico.</p>;
  if (events.length === 0) return <p className="text-muted-foreground">Nenhum custo ou preço registrado ainda.</p>;

  return (
    <ul className="flex max-h-72 flex-col divide-y overflow-auto">
      {events.slice(0, 40).map((event, index) => (
        <li key={`${event.kind}-${event.date}-${event.recorded_at}-${index}`} className={event.superseded ? "py-2 opacity-60" : "py-2"}>
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="neutral">{event.kind === "cost" ? "Custo" : "Preço"}</StatusBadge>
            <span className="tabular font-medium">
              {event.previous_value_cents !== null ? `${money(event.previous_value_cents)} → ` : ""}
              {money(event.value_cents)}
            </span>
            <span className="text-xs text-muted-foreground">desde {date(event.date)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {event.source}
            {event.invoice_number ? ` · nota ${event.invoice_number}` : ""}
            {event.actor ? ` · ${event.actor}` : ""}
            {event.reason ? ` · ${event.reason}` : ""}
            {event.superseded ? " · substituída" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
