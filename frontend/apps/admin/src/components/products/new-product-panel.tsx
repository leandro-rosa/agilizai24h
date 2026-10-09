"use client";

import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CostSources } from "@/components/pricing/cost-sources";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useChooseNewProductPriceMutation } from "@/lib/api/pricing";
import { useAddProductEanMutation, useCreateProductMutation, useGetCategoriesQuery, useGetNextSkuQuery, useRecordCostMutation, type Product } from "@/lib/api/products";
import { EMPTY_CLASSIFICATION, type ClassificationState } from "@/lib/products/taxonomy";
import { PURCHASE_MODE_ARTICLE, PURCHASE_MODE_FIELDS, PURCHASE_MODE_LABEL, purchaseCost, type PurchaseMode } from "@/lib/products/purchase-cost";
import { hasValidPrice } from "@/lib/products/suggestion";
import { useDraftSuggestion } from "@/lib/products/use-draft-suggestion";
import { formatCents, parseMoneyToCents } from "@/lib/purchases/money";
import { cn } from "@/lib/utils";
import { CategoryFields, useNameClassification } from "./category-fields";
import { Expandable, MoneyField, PanelSection } from "./money-field";

const today = () => new Date().toISOString().slice(0, 10);
const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")}%`;
const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const COST_REASON = "Custo informado no cadastro do produto";

type ApiError = { data?: { message?: string; code?: string; sku?: string } };
const messageOf = (failure: unknown, fallback: string) => (failure as ApiError)?.data?.message ?? fallback;

/**
 * O cadastro de produto novo, em painel lateral: o essencial primeiro (nome, categoria, como se compra e quanto se pagou), depois o preço, calculado pelo
 * MESMO motor da Precificação. Salvar o cadastro e aprovar o preço são ações distintas: dá para salvar sem preço. O SKU é automático e só definitivo ao salvar.
 */
export function NewProductPanel({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (product: Product) => void }) {
  const categories = useGetCategoriesQuery().data;
  const next = useGetNextSkuQuery(undefined, { skip: !open });
  const [createProduct] = useCreateProductMutation();
  const [addEan] = useAddProductEanMutation();
  const [recordCost] = useRecordCostMutation();
  const [choosePrice] = useChooseNewProductPriceMutation();

  const [name, setName] = useState("");
  const [classification, setClassification] = useState<ClassificationState>(EMPTY_CLASSIFICATION);
  const [mode, setMode] = useState<PurchaseMode>("unit");
  const [paidText, setPaidText] = useState("");
  const [unitsText, setUnitsText] = useState("");
  const [costDate, setCostDate] = useState(today());
  // `null` = o preço escolhido acompanha a sugestão; um texto = a pessoa digitou o dela, e nenhuma nova sugestão o sobrescreve.
  const [priceText, setPriceText] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [validFrom, setValidFrom] = useState(today());
  const [brand, setBrand] = useState("");
  const [netWeight, setNetWeight] = useState("");
  const [eans, setEans] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Se o produto já foi criado nesta sessão (e um passo seguinte falhou), uma nova tentativa não o cria de novo.
  const [created, setCreated] = useState<Product | null>(null);
  const [priceKey] = useState(() => `np-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  useNameClassification(name, setClassification, created === null);

  const cost = useMemo(() => purchaseCost(mode, paidText, unitsText), [mode, paidText, unitsText]);
  const typedCents = priceText === null ? null : parseMoneyToCents(priceText);
  const { view, loading, retry } = useDraftSuggestion({ category: classification.category || null, unitCostCents: cost.unitCents, typedPriceCents: typedCents, name }, open);

  const suggestion = view.kind === "ready" ? view.suggestion : null;
  const suggestedCents = suggestion?.suggestedPriceCents ?? null;
  const following = priceText === null;
  const chosenCents = following ? suggestedCents : typedCents;
  const differsFromSuggestion = !following && chosenCents !== suggestedCents;
  // A margem só aparece quando a resposta é DESTE preço: a de outro preço nunca fica ao lado do que está digitado.
  const margin = following ? (suggestion?.suggestedMargin ?? null) : suggestion?.typedPrice?.priceCents === typedCents ? (suggestion?.typedPrice?.margin ?? null) : null;
  const contributionCents = chosenCents !== null && margin !== null ? Math.round(chosenCents * margin) : null;
  const marginPending = chosenCents !== null && margin === null && (loading || view.kind === "ready");

  const categoryNameOf = (key: string) => categories?.find((row) => row.key === key)?.name ?? null;
  const typedEans = eans.map((e) => e.trim()).filter(Boolean);
  const baseProblem = useMemo(() => {
    if (!name.trim()) return "Informe o nome do produto.";
    if (!classification.category) return "Escolha a categoria (ou aceite a sugerida).";
    if (typedEans.some((e) => !/^\d{8,14}$/.test(e))) return "Cada código de barras deve ter de 8 a 14 dígitos.";
    if (new Set(typedEans).size !== typedEans.length) return "Há um código de barras repetido.";
    if (cost.problem) return cost.problem;

    return null;
  }, [name, classification.category, typedEans, cost.problem]);

  // Enquanto a sugestão da entrada atual não chega, o preço mostrado é o da entrada ANTERIOR: não se salva preço nesse intervalo.
  const canSavePrice = baseProblem === null && hasValidPrice(chosenCents) && (!differsFromSuggestion || reason.trim() !== "") && !saving && !loading;

  async function ensureProduct(): Promise<Product | null> {
    if (created) return created;
    try {
      const fields = PURCHASE_MODE_FIELDS[mode];
      const product = await createProduct({
        // Sem SKU: o servidor dá o próximo automático ao salvar (e o devolve).
        name: name.trim(),
        category: classification.category,
        subcategory: classification.subcategory || undefined,
        // Quem salvou o formulário confirmou a classificação (sugerida ou escolhida): importações e notas passam a respeitá-la.
        classificationConfirmed: true,
        brand: brand.trim() || undefined,
        netWeight: netWeight.trim() || undefined,
        purchaseUnit: fields.purchaseUnit,
        packageType: fields.packageType,
        unitsPerPackage: mode !== "unit" && cost.units ? cost.units : undefined,
        ean: typedEans[0],
      }).unwrap();
      setCreated(product);
      for (const extra of typedEans.slice(1)) {
        await addEan({ productId: product.id, ean: extra, note: "Cadastro do produto" })
          .unwrap()
          .catch((failure) => toast.warning(`Produto cadastrado, mas o EAN ${extra} não foi vinculado: ${messageOf(failure, "erro desconhecido")}`));
      }
      if (cost.unitCents !== null) {
        await recordCost({ sku: product.sku, effective_from: costDate, cost_cents: cost.unitCents, reason: COST_REASON })
          .unwrap()
          .catch((failure) => toast.warning(`Produto cadastrado, mas o custo não foi registrado: ${messageOf(failure, "erro desconhecido")}`));
      }
      onCreated(product);

      return product;
    } catch (failure) {
      const data = (failure as ApiError)?.data;
      setProblem(data?.code === "ean_linked" && data.sku ? `Este EAN já está vinculado ao produto ${data.sku}. Nenhum produto foi criado.` : messageOf(failure, "Não foi possível cadastrar o produto."));

      return null;
    }
  }

  async function saveWithoutPrice() {
    setProblem(null);
    if (baseProblem) return setProblem(baseProblem);
    setSaving(true);
    try {
      const product = await ensureProduct();
      if (!product) return;
      toast.success(`${product.name} cadastrado (SKU ${product.sku}) sem preço.`);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveWithPrice() {
    setProblem(null);
    if (baseProblem) return setProblem(baseProblem);
    if (!hasValidPrice(chosenCents)) return setProblem("Não há preço para salvar: informe o custo para ver a sugestão ou digite um preço.");
    if (differsFromSuggestion && !reason.trim()) return setProblem("Informe o motivo do preço escolhido.");
    setSaving(true);
    // O estado `created` só muda no próximo render: este marcador diz, na hora, que o produto já existe se a aprovação falhar.
    let exists = created !== null;
    try {
      const product = await ensureProduct();
      if (!product) return;
      exists = true;
      await choosePrice({
        sku: product.sku,
        idempotencyKey: `${priceKey}:${following ? "suggested" : "hand"}:${chosenCents}`,
        choice: following ? "suggested_accepted" : "changed_by_hand",
        chosenPriceCents: chosenCents,
        reason: following ? undefined : reason.trim(),
        costCents: cost.unitCents ?? undefined,
        costOrigin: COST_REASON,
        effectiveFrom: validFrom,
      }).unwrap();
      toast.success(`${product.name} (SKU ${product.sku}) cadastrado com preço de ${formatCents(chosenCents)} a partir de ${validFrom.split("-").reverse().join("/")}.`);
      onOpenChange(false);
    } catch (failure) {
      setProblem(`${exists ? "O produto foi cadastrado, mas o preço não foi salvo: " : ""}${messageOf(failure, "Não foi possível salvar o preço.")}`);
    } finally {
      setSaving(false);
    }
  }

  const sku = created?.sku ?? null;
  const forecast = next.data?.suggested ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="text-2xl">Novo produto</SheetTitle>
          <SheetDescription>
            {sku ? (
              <>SKU {sku}</>
            ) : forecast ? (
              <>
                SKU automático · previsão <span className="tabular">{forecast}</span> <span className="text-xs">(o número definitivo é dado ao salvar)</span>
              </>
            ) : next.isError ? (
              "SKU automático · definido ao salvar"
            ) : (
              "SKU automático"
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
          <div role="group" aria-label="Como preencher" className="grid grid-cols-2 gap-3">
            <button type="button" aria-pressed className="flex h-12 items-center gap-3 rounded-lg border border-primary bg-primary/10 px-4 text-sm font-medium">
              <span aria-hidden className="grid size-4 place-items-center rounded-full border-2 border-primary">
                <span className="size-2 rounded-full bg-primary" />
              </span>
              Manual
            </button>
            <button type="button" disabled aria-disabled title="Ainda não disponível: nenhum processamento de imagem, texto ou áudio está instalado" className="flex h-12 cursor-not-allowed items-center gap-3 rounded-lg border px-4 text-sm text-muted-foreground opacity-70">
              <span aria-hidden className="size-4 rounded-full border-2" />
              Prints, texto ou áudio
            </button>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">Preencher por prints, texto ou áudio ainda não está disponível nesta instalação. Nada é simulado: o cadastro é manual.</p>

          <fieldset disabled={created !== null} className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span className="text-muted-foreground">Nome do produto</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do produto novo" placeholder="Ex.: Pizza de frango 400 g" className="h-11 text-base" />
            </label>

            <CategoryFields categories={categories} state={classification} onChange={setClassification} categoryLabel="Categoria" subcategoryLabel="Subcategoria" />

            <PanelSection title="Custo de compra">
              <div role="tablist" aria-label="Como você compra" className="grid grid-cols-3 overflow-hidden rounded-lg border">
                {(Object.keys(PURCHASE_MODE_LABEL) as PurchaseMode[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={mode === key}
                    onClick={() => setMode(key)}
                    className={cn("h-11 border-r text-sm font-medium last:border-r-0", mode === key ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60")}
                  >
                    {PURCHASE_MODE_LABEL[key]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {mode !== "unit" && (
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    <span className="text-muted-foreground">Unidades {PURCHASE_MODE_ARTICLE[mode].in} {PURCHASE_MODE_LABEL[mode].toLowerCase()}</span>
                    <Input value={unitsText} onChange={(e) => setUnitsText(e.target.value)} aria-label="Unidades na embalagem" inputMode="numeric" placeholder="Ex.: 12" className="tabular h-11 text-base" />
                  </label>
                )}
                <MoneyField label={mode === "unit" ? "Custo por unidade" : `Valor pago ${PURCHASE_MODE_ARTICLE[mode].by} ${PURCHASE_MODE_LABEL[mode].toLowerCase()}`} value={paidText} onChange={setPaidText} placeholder="15,90" />
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  <span className="text-muted-foreground">Data do custo</span>
                  <Input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} aria-label="Data do custo" className="h-11 text-base" />
                </label>
              </div>
              {cost.problem && (
                <p role="alert" className="text-sm text-destructive">
                  {cost.problem}
                </p>
              )}
              {cost.explanation && (
                <p className="text-sm" data-testid="unit-cost">
                  Custo unitário calculado: <strong className="tabular">{cost.unitCents === null ? "—" : formatCents(cost.unitCents)}</strong>
                  {mode !== "unit" && <span className="text-muted-foreground"> · {cost.explanation}</span>}
                </p>
              )}
              <p className="text-xs text-muted-foreground">Cadastrar um custo não cria estoque nem compra recebida.</p>
            </PanelSection>
          </fieldset>

          <PanelSection
            title="Defina o preço"
            aside={
              loading ? (
                <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RefreshCw aria-hidden className="size-3 animate-spin" />
                  Calculando…
                </span>
              ) : null
            }
          >
            <SuggestionNotice view={view} onRetry={retry} />

            <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", loading && "opacity-50 transition-opacity")} aria-busy={loading}>
              <MoneyField label="Preço sugerido" value={suggestedCents !== null ? reais(suggestedCents) : ""} readOnly placeholder="—" hint={suggestion ? `Meta de contribuição ${pct(suggestion.targetMargin)}` : undefined} />
              <MoneyField
                label="Preço de venda"
                value={following ? (suggestedCents !== null ? reais(suggestedCents) : "") : (priceText ?? "")}
                onChange={(value) => setPriceText(value)}
                placeholder={suggestedCents === null ? "Digite um preço" : undefined}
                error={!following && priceText !== "" && typedCents === null ? "Informe um preço válido, maior que zero." : null}
                hint={!following && suggestedCents !== null ? undefined : "Acompanha a sugestão até você digitar outro."}
              />
            </div>

            {!following && (
              <div className="flex flex-wrap items-end gap-3">
                {suggestedCents !== null && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setPriceText(null)}>
                    Usar o preço sugerido ({formatCents(suggestedCents)})
                  </Button>
                )}
                {differsFromSuggestion && (
                  <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium">
                    <span className="text-muted-foreground">Motivo do preço escolhido (obrigatório)</span>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo do preço escolhido" className="h-11" />
                  </label>
                )}
              </div>
            )}

            <div className={cn("grid grid-cols-2 gap-4 rounded-lg border p-4", loading && "opacity-50 transition-opacity")} aria-busy={loading}>
              <div>
                <p className="text-xs text-muted-foreground">Margem de contribuição estimada no preço escolhido</p>
                <p className="tabular text-2xl font-semibold" data-testid="chosen-margin">
                  {loading ? "Calculando…" : margin !== null ? pct(margin) : marginPending ? "Calculando…" : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Contribuição por unidade</p>
                <p className="tabular text-2xl font-semibold">{contributionCents !== null ? formatCents(contributionCents) : "—"}</p>
                <p className="text-right text-xs text-muted-foreground">Simulação ilustrativa</p>
              </div>
            </div>

            {suggestion?.structure && (
              <div className="flex flex-col gap-2 rounded-lg border p-4" data-testid="new-product-sources">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  De onde vêm a perda e as taxas <StatusBadge tone="attention">Sugestão inicial · confiança {suggestion.confidence === "low" ? "baixa" : suggestion.confidence}</StatusBadge>
                </p>
                <CostSources structure={suggestion.structure} names={{ category: categoryNameOf(classification.category) }} newProduct />
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 font-medium">
                <span className="text-muted-foreground">Início da vigência do preço</span>
                <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} aria-label="Início da vigência" className="h-11 text-base" />
              </label>
              <p className="self-end text-xs text-muted-foreground">Escopo: todas as lojas. O preço é único para a rede; o cadastro não guarda preço por loja. Salvar registra você, a data e o preço anterior; a publicação no PDV não faz parte.</p>
            </div>
          </PanelSection>

          <Expandable title="Mais informações" hint="marca, peso e EANs">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 font-medium">
                <span className="text-muted-foreground">Marca (opcional)</span>
                <Input value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca do produto novo" className="h-11" />
              </label>
              <label className="flex flex-col gap-1.5 font-medium">
                <span className="text-muted-foreground">Peso ou volume (opcional)</span>
                <Input value={netWeight} onChange={(e) => setNetWeight(e.target.value)} aria-label="Peso ou volume" placeholder="Ex.: 400 g, 269 ml" className="h-11" />
              </label>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-muted-foreground">Códigos de barras (EAN): o primeiro é o principal</span>
              {eans.map((ean, index) => (
                <Input
                  key={index}
                  value={ean}
                  inputMode="numeric"
                  aria-label={index === 0 ? "EAN principal" : `EAN adicional ${index}`}
                  placeholder={index === 0 ? "Código de barras principal" : "Outro código da mesma unidade"}
                  className="h-11"
                  onChange={(e) => setEans((list) => list.map((value, i) => (i === index ? e.target.value : value)))}
                />
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setEans((list) => [...list, ""])}>
                  + Adicionar outro EAN
                </Button>
              </div>
            </div>
          </Expandable>

          {suggestion && (
            <Expandable title="Como o preço foi calculado">
              <ul className="list-disc pl-5 text-muted-foreground">
                {suggestion.reasons.map((text) => (
                  <li key={text}>{text}</li>
                ))}
                {suggestion.dataUsed.map((row) => (
                  <li key={row.code}>
                    {row.label}: {row.value} — {row.origin}
                  </li>
                ))}
              </ul>
            </Expandable>
          )}

          {problem && (
            <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
              {problem}
            </p>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-3 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="mr-auto h-11">
            {created ? "Fechar" : "Cancelar"}
          </Button>
          <Button variant="outline" onClick={saveWithoutPrice} disabled={saving || created !== null} className="h-11">
            Salvar sem preço
          </Button>
          <Button onClick={saveWithPrice} disabled={!canSavePrice} className="h-11" title={hasValidPrice(chosenCents) ? undefined : "Informe o custo para ver o preço sugerido, ou digite um preço"}>
            {saving ? "Salvando…" : created ? "Salvar preço" : "Salvar produto e preço"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** O estado da sugestão em palavras: o que falta, por que a meta não fecha, a ressalva de um cálculo possível ou a falha técnica com "tentar de novo". */
export function SuggestionNotice({ view, onRetry }: { view: ReturnType<typeof useDraftSuggestion>["view"]; onRetry: () => void }) {
  if (view.kind === "idle") return <p className="text-sm text-muted-foreground">{view.reason}</p>;
  if (view.kind === "missing")
    return (
      <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="missing">
        <p className="font-medium">Não há preço sugerido ainda. Falta:</p>
        <ul className="list-disc pl-5 text-muted-foreground">
          {view.reasons.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
    );
  if (view.kind === "unreachable")
    return (
      <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="unreachable">
        <p className="font-medium">A meta de margem não fecha com estes custos.</p>
        <p className="text-muted-foreground">{view.reason}. Nenhum preço é inventado: ajuste o custo ou a meta, ou digite o preço que quiser.</p>
      </div>
    );
  if (view.kind === "failed")
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="failed">
        <div>
          <p className="font-medium text-destructive">Não foi possível calcular a sugestão.</p>
          <p className="text-muted-foreground">{view.message}</p>
          {view.detail && <p className="text-xs text-muted-foreground">Detalhe técnico: {view.detail}</p>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden /> Tentar de novo
        </Button>
      </div>
    );

  return view.caveats.length === 0 ? null : (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="caveats">
      {view.caveats.map((text) => (
        <li key={text} className="flex items-start gap-2">
          <StatusBadge tone="attention">Ressalva</StatusBadge>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}
