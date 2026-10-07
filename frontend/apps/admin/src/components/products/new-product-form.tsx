"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useChooseNewProductPriceMutation, useDraftSuggestionMutation, type NewProductSuggestion } from "@/lib/api/pricing";
import { useAddProductEanMutation, useCreateProductMutation, useGetCategoriesQuery, useGetNextSkuQuery, useRecordCostMutation, type Product } from "@/lib/api/products";
import { count as formatCount } from "@/lib/format";
import { EMPTY_CLASSIFICATION, unitCostCents, type ClassificationState } from "@/lib/products/taxonomy";
import { formatCents, parseMoneyToCents } from "@/lib/purchases/money";
import { CategoryFields, useNameClassification } from "./category-fields";

const today = () => new Date().toISOString().slice(0, 10);
const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")}%`;
const COST_REASON = "Custo informado no cadastro do produto";

type ApiError = { data?: { message?: string; code?: string; sku?: string } };
const messageOf = (failure: unknown, fallback: string) => (failure as ApiError)?.data?.message ?? fallback;

/**
 * O cadastro de produto novo, integrado à precificação: assim que há um custo válido o formulário mostra o custo por unidade vendida, o preço sugerido,
 * a margem nele e a meta usada — calculados pelo MESMO motor da Precificação Inteligente (nada de fórmula aqui; o navegador só divide o custo da caixa pelo
 * fator). Produto sem vendas recebe uma sugestão inicial, sem volume nem impacto; o que faltar é dito, e zero nunca aparece como preço ou margem.
 * Salvar o cadastro e aprovar o preço são ações distintas: dá para salvar com o preço pendente.
 */
export function NewProductForm({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (product: Product) => void }) {
  const categories = useGetCategoriesQuery().data;
  const next = useGetNextSkuQuery();
  const [createProduct] = useCreateProductMutation();
  const [addEan] = useAddProductEanMutation();
  const [recordCost] = useRecordCostMutation();
  const [choosePrice] = useChooseNewProductPriceMutation();
  const [draft] = useDraftSuggestionMutation();

  const [sku, setSku] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [eans, setEans] = useState<string[]>([""]);
  const [classification, setClassification] = useState<ClassificationState>(EMPTY_CLASSIFICATION);
  const [brand, setBrand] = useState("");
  const [saleUnit, setSaleUnit] = useState("un");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [packageType, setPackageType] = useState("");
  const [factor, setFactor] = useState("1");
  const [costText, setCostText] = useState("");
  const [costDate, setCostDate] = useState(today());
  const [typing, setTyping] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [reason, setReason] = useState("");
  const [validFrom, setValidFrom] = useState(today());
  const [suggestion, setSuggestion] = useState<NewProductSuggestion | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Se o produto já foi criado nesta sessão (e um passo seguinte falhou), uma nova tentativa não o cria de novo.
  const [created, setCreated] = useState<Product | null>(null);
  const [priceKey] = useState(() => `np-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  useNameClassification(name, setClassification, created === null);

  const suggestedSku = next.data?.suggested ?? null;
  const skuValue = sku ?? suggestedSku ?? "";
  const packageCents = parseMoneyToCents(costText);
  const factorNumber = factor.trim() === "" ? null : Number(factor);
  const unitCents = unitCostCents(packageCents, factorNumber);
  const typedCents = typing ? parseMoneyToCents(typedText) : null;
  const category = classification.category;

  // A sugestão acompanha o custo, o fator, a categoria e o preço digitado: cada mudança recalcula (o motor decide; aqui só se pergunta).
  useEffect(() => {
    if (unitCents === null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCalculating(true);
      try {
        const answer = await draft({ category: category || null, unitCostCents: unitCents, typedPriceCents: typedCents, name: name.trim() || undefined }).unwrap();
        if (!cancelled) setSuggestion(answer.suggestion);
      } catch {
        if (!cancelled) setSuggestion(null);
      } finally {
        if (!cancelled) setCalculating(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [unitCents, category, typedCents, name, draft]);

  const shown = unitCents === null ? null : suggestion;
  const price = shown?.suggestedPriceCents ?? null;
  const chosenCents = typing ? typedCents : price;
  const chosenMargin = typing ? (shown?.typedPrice?.margin ?? null) : (shown?.suggestedMargin ?? null);
  const baseProblem = useMemo(() => {
    if (!skuValue.trim()) return "Informe o código (SKU).";
    if (!name.trim()) return "Informe o nome do produto.";
    if (!category) return "Escolha a categoria (ou aceite a sugerida).";
    const typedEans = eans.map((e) => e.trim()).filter(Boolean);
    if (typedEans.some((e) => !/^\d{8,14}$/.test(e))) return "Cada código de barras deve ter de 8 a 14 dígitos.";
    if (new Set(typedEans).size !== typedEans.length) return "Há um código de barras repetido.";
    if (factorNumber === null || !Number.isInteger(factorNumber) || factorNumber < 1) return "O fator de conversão deve ser um número inteiro de 1 em diante.";
    if (costText.trim() && packageCents === null) return "O custo informado não é um valor válido.";

    return null;
  }, [skuValue, name, category, eans, factorNumber, costText, packageCents]);

  async function ensureProduct(): Promise<Product | null> {
    if (created) return created;
    const typedEans = eans.map((e) => e.trim()).filter(Boolean);
    try {
      const product = await createProduct({
        sku: skuValue.trim(),
        name: name.trim(),
        category,
        subcategory: classification.subcategory || undefined,
        // Quem salvou o formulário confirmou a classificação (sugerida ou escolhida): importações e notas passam a respeitá-la.
        classificationConfirmed: true,
        brand: brand.trim() || undefined,
        saleUnit: saleUnit.trim() || undefined,
        purchaseUnit: purchaseUnit.trim() || undefined,
        packageType: packageType.trim() || undefined,
        unitsPerPackage: (factorNumber ?? 1) >= 2 ? (factorNumber as number) : undefined,
        ean: typedEans[0],
      }).unwrap();
      setCreated(product);
      for (const extra of typedEans.slice(1)) {
        await addEan({ productId: product.id, ean: extra, note: "Cadastro do produto" })
          .unwrap()
          .catch((failure) => toast.warning(`Produto cadastrado, mas o EAN ${extra} não foi vinculado: ${messageOf(failure, "erro desconhecido")}`));
      }
      if (unitCents !== null) {
        await recordCost({ sku: product.sku, effective_from: costDate, cost_cents: unitCents, reason: COST_REASON })
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

  async function saveOnly() {
    setProblem(null);
    if (baseProblem) return setProblem(baseProblem);
    setSaving(true);
    try {
      const product = await ensureProduct();
      if (!product) return;
      toast.success(`${product.name} cadastrado com o preço pendente.`);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveAndApprove() {
    setProblem(null);
    if (baseProblem) return setProblem(baseProblem);
    if (chosenCents === null || chosenCents <= 0) return setProblem("Não há preço para aprovar: informe um custo válido ou digite um preço.");
    if (typing && !reason.trim()) return setProblem("Informe o motivo do preço digitado.");
    setSaving(true);
    // O estado `created` só muda no próximo render: este marcador diz, na hora, que o produto já existe se a aprovação falhar.
    let exists = created !== null;
    try {
      const product = await ensureProduct();
      if (!product) return;
      exists = true;
      await choosePrice({
        sku: product.sku,
        idempotencyKey: `${priceKey}:${typing ? "hand" : "suggested"}:${chosenCents}`,
        choice: typing ? "changed_by_hand" : "suggested_accepted",
        chosenPriceCents: chosenCents,
        reason: typing ? reason.trim() : undefined,
        costCents: unitCents ?? undefined,
        costOrigin: COST_REASON,
        effectiveFrom: validFrom,
      }).unwrap();
      toast.success(`${product.name} cadastrado e preço de ${formatCents(chosenCents)} aprovado a partir de ${validFrom.split("-").reverse().join("/")}.`);
      onOpenChange(false);
    } catch (failure) {
      setProblem(`${exists ? "O produto foi cadastrado, mas o preço não foi aprovado: " : ""}${messageOf(failure, "Não foi possível aprovar o preço.")}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Novo produto</DialogTitle>
          <DialogDescription>O produto entra no cadastro único e, com o custo, já mostra o preço sugerido pela Precificação Inteligente. Salvar o cadastro e aprovar o preço são passos separados.</DialogDescription>
        </DialogHeader>

        <fieldset disabled={created !== null} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
              Nome
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do produto novo" placeholder="Ex.: Monster Energy 269 ml" />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
              SKU
              <Input value={skuValue} onChange={(e) => setSku(e.target.value)} aria-label="SKU do produto novo" inputMode="numeric" />
              {suggestedSku !== null && sku === null && <span>Sugestão do sistema (o próximo depois do maior SKU de 6 dígitos): confirme ou troque.</span>}
            </label>
          </div>

          <CategoryFields categories={categories} state={classification} onChange={setClassification} categoryLabel="Categoria do produto novo" subcategoryLabel="Subcategoria do produto novo" />

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Códigos de barras (EAN): o primeiro é o principal</span>
            {eans.map((ean, index) => (
              <Input key={index} value={ean} inputMode="numeric" aria-label={index === 0 ? "EAN principal" : `EAN adicional ${index}`} placeholder={index === 0 ? "Código de barras principal" : "Outro código da mesma unidade"} onChange={(e) => setEans((list) => list.map((value, i) => (i === index ? e.target.value : value)))} />
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setEans((list) => [...list, ""])}>
                + Adicionar outro EAN
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Marca (opcional)
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca do produto novo" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Unidade de compra
              <Input value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} aria-label="Unidade de compra do produto novo" placeholder="CX, FD, UN…" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Unidade de venda
              <Input value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)} aria-label="Unidade de venda do produto novo" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Fator: unidades por caixa/fardo
              <Input value={factor} onChange={(e) => setFactor(e.target.value)} aria-label="Fator de conversão" inputMode="numeric" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
              Tipo de embalagem (opcional)
              <Input value={packageType} onChange={(e) => setPackageType(e.target.value)} aria-label="Tipo de embalagem do produto novo" placeholder="caixa, fardo…" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Custo de compra (R$)
              <Input value={costText} onChange={(e) => setCostText(e.target.value)} aria-label="Custo de compra" inputMode="decimal" placeholder="Ex.: 60,00" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Data do custo
              <Input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} aria-label="Data do custo" />
            </label>
          </div>
        </fieldset>

        <section aria-label="Preço sugerido" className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Preço sugerido</h3>
            <StatusBadge tone="attention">Sugestão inicial — sem histórico de vendas</StatusBadge>
          </div>

          {unitCents === null ? (
            <p className="text-sm text-muted-foreground" data-testid="needs-cost">
              Informe um custo válido {factorNumber === null || factorNumber < 1 || !Number.isInteger(factorNumber) ? "e um fator de conversão inteiro " : ""}para calcular o preço sugerido.
            </p>
          ) : (
            <>
              <p className="text-sm" data-testid="unit-cost">
                {(factorNumber ?? 1) >= 2 && packageCents !== null ? (
                  <>
                    Custo da embalagem {formatCents(packageCents)} ÷ {formatCount(factorNumber as number)} = <strong>{formatCents(unitCents)}</strong> por unidade vendida
                  </>
                ) : (
                  <>
                    Custo por unidade vendida: <strong>{formatCents(unitCents)}</strong>
                  </>
                )}
              </p>

              {calculating && !shown ? (
                <p className="text-sm text-muted-foreground">Calculando…</p>
              ) : shown && shown.status === "suggested" && price !== null ? (
                <div className="grid grid-cols-3 gap-2" data-testid="suggestion">
                  <div>
                    <p className="text-xs text-muted-foreground">Preço sugerido</p>
                    <p className="tabular text-2xl font-semibold">{formatCents(price)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Margem estimada no sugerido</p>
                    <p className="tabular text-lg font-semibold">{shown.suggestedMargin === null ? "—" : pct(shown.suggestedMargin)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Meta utilizada</p>
                    <p className="tabular text-lg font-semibold">{pct(shown.targetMargin)}</p>
                    <p className="text-xs text-muted-foreground">mínima {pct(shown.minimumMargin)}</p>
                  </div>
                </div>
              ) : shown ? (
                <div role="alert" className="rounded-md border border-warning/40 p-2 text-sm text-warning" data-testid="missing">
                  <p className="font-medium">Não há preço sugerido. Falta:</p>
                  <ul className="list-disc pl-5">
                    {shown.insufficientReasons.map((reasonText) => (
                      <li key={reasonText}>{reasonText}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-destructive">Não foi possível calcular a sugestão agora. O cadastro pode ser salvo com o preço pendente.</p>
              )}

              {shown && shown.status === "suggested" && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Como foi calculado</summary>
                  <ul className="list-disc pl-5 pt-1">
                    {shown.reasons.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                    {shown.dataUsed.map((row) => (
                      <li key={row.code}>
                        {row.label}: {row.value} — {row.origin}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          <div className="flex flex-col gap-2 border-t pt-2">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={typing} onChange={(e) => setTyping(e.target.checked)} />
              Informar outro preço
            </label>
            {typing && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Preço (R$)
                  <Input value={typedText} onChange={(e) => setTypedText(e.target.value)} aria-label="Outro preço" inputMode="decimal" placeholder="Ex.: 6,90" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Motivo (obrigatório)
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo do preço digitado" />
                </label>
                <p className="col-span-2 text-sm" data-testid="typed-margin">
                  {typedCents === null ? "Digite um preço para ver a margem." : chosenMargin === null ? "A margem neste preço aparece quando houver custo e parâmetros para calcular." : `Margem estimada neste preço: ${pct(chosenMargin)}`}
                </p>
              </div>
            )}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:w-56">
              Início da vigência do preço
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} aria-label="Início da vigência" />
            </label>
            <p className="text-xs text-muted-foreground">Aprovar registra você, a data e o preço anterior. Nenhum preço é aprovado sem esta ação, e a publicação no PDV não faz parte dela.</p>
          </div>
        </section>

        {problem && (
          <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
            {problem}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {created ? "Fechar" : "Cancelar"}
          </Button>
          <Button variant="outline" onClick={saveOnly} disabled={saving || created !== null}>
            Salvar com preço pendente
          </Button>
          <Button onClick={saveAndApprove} disabled={saving}>
            {saving ? "Salvando…" : created ? "Aprovar preço" : "Salvar e aprovar preço"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

