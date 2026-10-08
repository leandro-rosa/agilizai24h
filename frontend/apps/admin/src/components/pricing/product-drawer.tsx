"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useGetPricingDecisionsQuery,
  useGetProductHistoryQuery,
  useGetProductStoresQuery,
  useSimulatePriceMutation,
  type PricingProduct,
  type PricingRunView,
  type Simulation,
} from "@/lib/api/pricing";
import { count, date, money, period as formatPeriod } from "@/lib/format";
import { costBreakdown } from "@/lib/pricing/breakdown";
import { CONFIDENCE_LABEL, CONFIDENCE_TONE, costOriginText, parsePriceToCents, percent, points, signedMoney, STATUS_LABEL, STATUS_TONE } from "@/lib/pricing/labels";

import { ApplyPriceDialog, errorMessage } from "./apply-price-dialog";
import { CostBasesSection, ReconciliationSection } from "./cost-bases";
import { marginMetric } from "@/lib/pricing/metric";
import { IMPACT_PREMISE } from "./summary-cards";

export interface DrawerScope {
  period: string;
  storeId: number | null;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular text-base font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Como este número nasceu, para quem for conferir: o custo (método e origem), o que entrou na estrutura, que margem é essa, a meta e a premissa do impacto. */
function CalculationDetails({ product, run, scope }: { product: PricingProduct; run: PricingRunView | null; scope: DrawerScope }) {
  const structure = product.structure;
  const metric = marginMetric(product.engineVersion);
  const origin = costOriginText(product.costOrigin);

  return (
    <section aria-labelledby="calculation" className="flex flex-col gap-2">
      <h3 id="calculation" className="text-sm font-semibold">Como este número foi calculado</h3>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Custo: método e origem</dt>
          <dd>
            {structure ? money(structure.productCostCents) : "Sem custo utilizável"} · custo vigente no último dia de {formatPeriod(scope.period)} (a mesma regra do CMV do financeiro){origin ? ` · origem: ${origin}` : ""}
            {product.newerCost && (
              <span className="block text-warning">
                O cadastro tem um custo mais novo ({money(product.newerCost.costCents)}, desde {date(product.newerCost.effectiveFrom)}, {product.newerCost.basis === "registry_or_manual" ? "cadastral ou manual, sem compra recebida" : "de compra recebida"}). Este período é histórico: o custo novo não entra nele; a sugestão atual, abaixo, mostra o efeito.
              </span>
            )}
          </dd>
        </div>
        {structure && (
          <div>
            <dt className="text-xs text-muted-foreground">Impostos, taxas e demais despesas consideradas</dt>
            <dd>
              Imposto {pct2(structure.taxRate)} · taxas de pagamento {pct2(structure.paymentRate)}
              {structure.paymentFixedCents > 0 ? ` + ${money(Math.round(structure.paymentFixedCents))} por unidade (taxa fixa repartida pelas unidades)` : ""} · perda {percent(structure.lossRate)} ({LOSS_LEVEL_TEXT[structure.lossLevel] ?? structure.lossLevel}) · despesas proporcionais à venda {pct2(structure.operatingShare)}
              {(structure.perTransactionCents ?? 0) > 0 ? ` · custo por transação ${money(Math.round(structure.perTransactionCents as number))} por unidade` : ""}
              {structure.paymentFixed && structure.paymentFixed.basis !== "coupon" && <span className="block text-xs text-warning">Aproximação: {structure.paymentFixed.note}</span>}
              {structure.paymentFixed && structure.paymentFixed.basis === "coupon" && <span className="block text-xs text-muted-foreground">{structure.paymentFixed.note}</span>}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Tipo de margem</dt>
          <dd>{metric.definition}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Meta aplicada</dt>
          <dd>
            {percent(product.targetMargin, 0)} {product.marginFromCategory ? "(meta da categoria)" : "(meta padrão)"} · margem mínima {percent(product.minimumMargin, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Premissa do impacto estimado</dt>
          <dd>{IMPACT_PREMISE}</dd>
        </div>
      </dl>
      <CostBasesSection product={product} />
      <ReconciliationSection product={product} />
      {product.estimatedResultAfterAllocation && <p className="text-xs text-muted-foreground">Resultado após rateio: {product.estimatedResultAfterAllocation.criterion}.</p>}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Detalhes técnicos (auditoria)</summary>
        <p className="pt-1">
          Motor {product.engineVersion} · regras v{run?.parameterVersion ?? "—"} · calculado em {run?.computedAt ? date(run.computedAt) : "—"}. Resultado reproduzível a partir das entradas guardadas e dessa versão de regras.
        </p>
      </details>
    </section>
  );
}

/** Taxas e impostos em duas casas (7,07%): arredondar para uma esconderia o número que o dono cadastrou. */
const pct2 = (fraction: number) => `${(fraction * 100).toFixed(2).replace(".", ",")}%`;

const LOSS_LEVEL_TEXT: Record<string, string> = { product: "do produto", category: "da categoria", store: "da loja", network: "da rede" };

function Overview({ product, run, scope, onApply, onSimulate, canWrite, historical }: { product: PricingProduct; run: PricingRunView | null; scope: DrawerScope; onApply: () => void; onSimulate: () => void; canWrite: boolean; historical: boolean }) {
  const breakdown = useMemo(() => costBreakdown(product), [product]);
  const metric = marginMetric(product.engineVersion);
  const { data: decisions } = useGetPricingDecisionsQuery({ sku: product.sku, limit: 10 });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[product.status]}>{STATUS_LABEL[product.status]}</StatusBadge>
        <StatusBadge tone={CONFIDENCE_TONE[product.confidence]}>Confiança {CONFIDENCE_LABEL[product.confidence].toLowerCase()}</StatusBadge>
        {product.validated === false && product.status !== "insufficient_data" && <StatusBadge tone="attention">Não validado: despesas sem classificação</StatusBadge>}
      </div>
      {(product.validationNotes ?? []).length > 0 && product.status !== "insufficient_data" && (
        <ul className="flex list-disc flex-col gap-1 rounded-lg border border-warning/30 bg-warning/12 p-3 pl-7 text-xs text-warning">
          {(product.validationNotes ?? []).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <section aria-labelledby="situation" className="flex flex-col gap-2">
        <h3 id="situation" className="text-sm font-semibold">Situação atual</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Fact label="Custo médio" value={money(product.structure?.productCostCents ?? null)} hint={costOriginText(product.costOrigin) ?? undefined} />
          <Fact label="Preço atual" value={money(product.currentPriceCents)} />
          <Fact label={metric.name} value={percent(product.currentMargin)} hint={`Meta ${percent(product.targetMargin, 0)}`} />
          {metric.key === "contribution" && <Fact label="Contribuição por unidade" value={product.unitContributionCents === null || product.unitContributionCents === undefined ? "—" : money(Math.round(product.unitContributionCents))} hint="o que cada venda deixa para cobrir a operação" />}
          {metric.key === "contribution" && (
            <Fact
              label="Resultado após rateio (estimativa)"
              value={percent(product.estimatedResultAfterAllocation?.margin)}
              hint={product.estimatedResultAfterAllocation ? "depende do critério de rateio; não é lucro líquido" : undefined}
            />
          )}
          <Fact label="Markup atual" value={product.currentMarkup === null ? "—" : product.currentMarkup.toFixed(2).replace(".", ",")} />
          <Fact label="Vendas (mês)" value={`${count(Math.round(product.monthlyUnits))} un.`} />
          <Fact label="Faturamento (mês)" value={money(product.monthlyRevenueCents === null ? null : Math.round(product.monthlyRevenueCents))} />
        </div>
      </section>

      <section aria-labelledby="prices" className="flex flex-col gap-2">
        <h3 id="prices" className="text-sm font-semibold">Preços sugeridos pela IA</h3>
        <div className="grid grid-cols-3 gap-2">
          <Fact label="Preço mínimo" value={money(product.minimumPriceCents)} hint={`Margem ${percent(product.minimumMargin, 0)}`} />
          <Fact label="Preço-meta" value={money(product.targetPriceCents)} hint={`Margem ${percent(product.targetMargin, 0)}`} />
          <div className="rounded-lg border border-primary/50 bg-primary/10 p-3">
            <p className="text-xs text-muted-foreground">Preço recomendado</p>
            <p className="tabular text-base font-semibold">{money(product.recommendedPriceCents)}</p>
            <p className="text-xs text-muted-foreground">{product.recommendedMargin === null ? "Sem recomendação" : `Margem ${percent(product.recommendedMargin)}`}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="why" className="flex flex-col gap-2">
        <h3 id="why" className="text-sm font-semibold">Por que a IA recomenda esse preço?</h3>
        {product.insufficientReasons.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {product.insufficientReasons.map((text) => (
              <li key={text}>{text}. Não há recomendação automática para este produto.</li>
            ))}
          </ul>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {product.reasons.map((reason) => (
              <li key={reason.code}>{reason.text}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="impact" className="flex flex-col gap-2">
        <h3 id="impact" className="text-sm font-semibold">Impacto estimado</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact label="Impacto (mês)" value={signedMoney(product.impactCentsPerMonth)} hint="Impacto potencial estimado" />
          <Fact label="Margem estimada" value={percent(product.recommendedMargin)} />
          <Fact label="Alteração de preço" value={product.recommendedPriceCents === null || product.currentPriceCents === null ? "—" : `${money(product.currentPriceCents)} → ${money(product.recommendedPriceCents)}`} />
          <Fact label="Volume atual" value={`${count(Math.round(product.monthlyUnits))} un./mês`} />
        </div>
        {product.monthlyMarginCents !== null && <p className="text-xs text-muted-foreground">Margem potencial hoje: {money(Math.round(product.monthlyMarginCents))} por mês.</p>}
      </section>

      <section aria-labelledby="structure" className="flex flex-col gap-2">
        <h3 id="structure" className="text-sm font-semibold">Estrutura de custos considerada</h3>
        {breakdown === null ? (
          <p className="text-sm text-muted-foreground">Sem estrutura de custos calculada: faltam dados para este produto.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">% sobre o preço</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="whitespace-normal">
                      {row.label}
                      {row.detail && <div className="max-w-sm whitespace-normal text-xs text-muted-foreground">{row.detail}</div>}
                    </TableCell>
                    <TableCell className="tabular text-right">{row.key === "voucher" ? "—" : money(Math.round(row.cents))}</TableCell>
                    <TableCell className="tabular text-right">{row.key === "voucher" ? "—" : percent(row.shareOfPrice)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Custos que o preço cobre (a diferença para o preço é a contribuição)</TableCell>
                  <TableCell className="tabular text-right">{money(Math.round(breakdown.economicCostCents))}</TableCell>
                  <TableCell className="tabular text-right">{percent(breakdown.economicCostShare)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">{breakdown.statement}</p>
          </>
        )}
      </section>

      <CalculationDetails product={product} run={run} scope={scope} />

      <section aria-labelledby="decisions" className="flex flex-col gap-2">
        <h3 id="decisions" className="text-sm font-semibold">Decisões de preço</h3>
        {!decisions || decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma decisão de preço registrada para este produto.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {decisions.map((decision) => (
              <li key={decision.id} className="rounded-lg border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular font-medium">
                    {money(decision.previousPriceCents)} → {money(decision.newPriceCents)}
                  </span>
                  <StatusBadge tone={decision.status === "applied" ? "positive" : decision.status === "failed" ? "critical" : "attention"}>
                    {decision.status === "applied" ? "Aplicado" : decision.status === "failed" ? "Falhou" : "Pendente"}
                  </StatusBadge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {date(decision.effectiveFrom)} · {decision.actor}
                  {decision.recommendedPriceCents !== null && ` · IA recomendava ${money(decision.recommendedPriceCents)}`}
                </p>
                {decision.reason && <p className="text-xs">Motivo: {decision.reason}</p>}
                {decision.error && <p className="text-xs text-destructive">{decision.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sticky bottom-0 flex gap-2 border-t bg-background py-3">
        {historical ? (
          <p className="text-xs text-muted-foreground">Cálculo mais antigo, só para leitura: simular e aplicar preço valem para o cálculo mais recente.</p>
        ) : (
          <Button variant="outline" className="flex-1" onClick={onSimulate}>
            Simular outro preço
          </Button>
        )}
        {canWrite && (
          <Button className="flex-1" onClick={onApply}>
            Aplicar novo preço
          </Button>
        )}
      </div>
    </div>
  );
}

function SimulationResult({ result }: { result: Simulation }) {
  if (!result.simulable) return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{result.reason}</p>;

  return (
    <div className="flex flex-col gap-2">
      {result.replacementCostCents !== undefined && <p className="text-xs text-warning">Simulado com a cotação de reposição de {money(result.replacementCostCents)} no lugar do custo do relatório.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="Margem de contribuição estimada" value={percent(result.margin)} hint={`Atual ${percent(result.currentMargin)}`} />
        <Fact label="Markup" value={result.markup.toFixed(2).replace(".", ",")} />
        <Fact label="Contribuição por unidade" value={money(Math.round(result.unitProfitCents))} />
        <Fact label="Impacto (mês)" value={signedMoney(Math.round(result.monthlyImpactCents))} hint="Impacto potencial estimado" />
        <Fact label="Diferença para a meta" value={points(result.differenceToTarget)} hint={`Meta ${percent(result.targetMargin, 0)}`} />
      </div>
    </div>
  );
}

function Simulator({ product, scope, canWrite, onApply }: { product: PricingProduct; scope: DrawerScope; canWrite: boolean; onApply: (cents: number) => void }) {
  const [text, setText] = useState("");
  const [quoteText, setQuoteText] = useState("");
  const quote = parsePriceToCents(quoteText);
  // A resposta guarda o preço que a gerou: uma resposta de outro preço digitado nunca aparece como a deste.
  const [outcome, setOutcome] = useState<{ cents: number; quote: number | null; result: Simulation | null; failure: string | null } | null>(null);
  const [simulate, { isLoading }] = useSimulatePriceMutation();
  const cents = parsePriceToCents(text);
  const shown = outcome !== null && outcome.cents === cents && outcome.quote === quote ? outcome : null;

  useEffect(() => {
    if (cents === null) return;
    const timer = setTimeout(async () => {
      try {
        setOutcome({ cents, quote, result: await simulate({ sku: product.sku, priceCents: cents, replacementCostCents: quote, period: scope.period, storeId: scope.storeId }).unwrap(), failure: null });
      } catch (error) {
        setOutcome({ cents, quote, result: null, failure: errorMessage(error) });
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [cents, quote, product.sku, scope.period, scope.storeId, simulate]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Preço atual: <span className="tabular font-medium text-foreground">{money(product.currentPriceCents)}</span>. Digite outro preço para testar &quot;e se eu vender por…?&quot;. Nada é alterado.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="simulate-price">Preço a simular (R$)</Label>
        <Input id="simulate-price" inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} placeholder="6,50" />
        {text !== "" && cents === null && <p className="text-xs text-destructive">Informe um preço válido, maior que zero.</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="simulate-quote">Cotação de reposição (R$, opcional)</Label>
        <Input id="simulate-quote" inputMode="decimal" value={quoteText} onChange={(event) => setQuoteText(event.target.value)} placeholder="Deixe vazio para usar o custo do relatório" />
        <p className="text-xs text-muted-foreground">Só para simular: troca o custo da mercadoria por este valor. Uma cotação não é uma compra e nunca é gravada como custo.</p>
        {quoteText !== "" && quote === null && <p className="text-xs text-destructive">Informe uma cotação válida, maior que zero.</p>}
      </div>
      {shown?.failure && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/12 p-3 text-sm text-destructive">{shown.failure}</p>}
      {cents !== null && shown === null && isLoading && <p role="status" className="text-sm text-muted-foreground">Calculando…</p>}
      {shown?.result && <SimulationResult result={shown.result} />}
      {canWrite && cents !== null && shown?.result?.simulable && (
        <Button variant="outline" onClick={() => onApply(cents)}>
          Aplicar este preço
        </Button>
      )}
    </div>
  );
}

function History({ sku, period }: { sku: string; period: string }) {
  const { data, isLoading, error, refetch } = useGetProductHistoryQuery({ sku, period });

  return (
    <RequestState isLoading={isLoading} error={error} isEmpty={data?.rows.length === 0} onRetry={refetch} emptyMessage="Sem histórico para este produto.">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Margem do produto: (preço − custo) ÷ preço, ao fim de cada mês. Não é a margem da recomendação (contribuição ou econômica, conforme o motor do relatório).</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="text-right">Margem</TableHead>
              <TableHead className="text-right">Markup</TableHead>
              <TableHead>O que mudou</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...(data?.rows ?? [])].reverse().map((row) => (
              <TableRow key={row.month}>
                <TableCell>{formatPeriod(row.month)}</TableCell>
                <TableCell className="tabular text-right">{money(row.costCents)}</TableCell>
                <TableCell className="tabular text-right">{money(row.priceCents)}</TableCell>
                <TableCell className="tabular text-right">{percent(row.margin)}</TableCell>
                <TableCell className="tabular text-right">{row.markup === null ? "—" : row.markup.toFixed(2).replace(".", ",")}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.costRose && <StatusBadge tone="attention">Custo subiu</StatusBadge>}
                    {row.priceChanged && <StatusBadge tone="neutral">Preço alterado</StatusBadge>}
                    {row.marginFell && <StatusBadge tone="critical">Margem caiu</StatusBadge>}
                    {row.marginImproved && <StatusBadge tone="positive">Margem melhorou</StatusBadge>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </RequestState>
  );
}

function Stores({ sku, period }: { sku: string; period: string }) {
  const { data, isLoading, error, refetch } = useGetProductStoresQuery({ sku, period });

  return (
    <RequestState isLoading={isLoading} error={error} isEmpty={data?.stores.length === 0 && data.missingStores.length === 0} onRetry={refetch} emptyMessage="Sem dados de lojas para este produto.">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">{data?.note}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead className="text-right">Vendas</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">Perda</TableHead>
              <TableHead className="text-right">Margem estimada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.stores ?? []).map((store) => (
              <TableRow key={store.storeId}>
                <TableCell>{store.storeName}</TableCell>
                <TableCell className="tabular text-right">{count(store.unitsSold)} un.</TableCell>
                <TableCell className="tabular text-right">{money(store.revenueCents)}</TableCell>
                <TableCell className="tabular text-right">{percent(store.lossRate)}</TableCell>
                <TableCell className="tabular text-right">{percent(store.estimatedMargin)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(data?.missingStores.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">Sem dados no período (não é venda zero): {data?.missingStores.map((store) => store.storeName).join(", ")}.</p>
        )}
      </div>
    </RequestState>
  );
}

function DrawerBody({
  product,
  scope,
  run,
  canWrite,
  historical,
  onApplied,
}: {
  product: PricingProduct;
  scope: DrawerScope;
  run: PricingRunView | null;
  canWrite: boolean;
  /** Um cálculo mais antigo, só para leitura: sem simular nem aplicar, que agem sobre o cálculo mais recente. */
  historical: boolean;
  onApplied: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [applying, setApplying] = useState<{ priceCents: number | null } | null>(null);

  return (
    <>
      <SheetHeader>
        <SheetTitle>{product.name ?? product.sku}</SheetTitle>
        <SheetDescription>
          {product.ean ? `EAN ${product.ean} · ` : ""}Código {product.sku} · {product.categoryLabel} · Fornecedor: {product.supplierName ?? "—"}
        </SheetDescription>
        <Link className="text-xs font-medium underline underline-offset-2" href={`/products?sku=${encodeURIComponent(product.sku)}&tab=overview`}>
          Editar cadastro
        </Link>
      </SheetHeader>

      <div className="px-4 pb-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            {!historical && <TabsTrigger value="simulator">Simulador</TabsTrigger>}
            <TabsTrigger value="history">Histórico</TabsTrigger>
            <TabsTrigger value="stores">Lojas</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-4">
            <Overview product={product} run={run} scope={scope} canWrite={canWrite} onSimulate={() => setTab("simulator")} historical={historical} onApply={() => setApplying({ priceCents: product.recommendedPriceCents })} />
          </TabsContent>
          <TabsContent value="simulator" className="pt-4">
            <Simulator product={product} scope={scope} canWrite={canWrite} onApply={(cents) => setApplying({ priceCents: cents })} />
          </TabsContent>
          <TabsContent value="history" className="pt-4">
            <History sku={product.sku} period={scope.period} />
          </TabsContent>
          <TabsContent value="stores" className="pt-4">
            <Stores sku={product.sku} period={scope.period} />
          </TabsContent>
        </Tabs>
      </div>

      <ApplyPriceDialog
        product={product}
        initialPriceCents={applying?.priceCents ?? null}
        runId={run?.id ?? null}
        open={applying !== null}
        onOpenChange={(open) => !open && setApplying(null)}
        onApplied={onApplied}
      />
    </>
  );
}

/** O painel lateral do produto: sem navegar para outra página. Trocar de produto remonta o corpo, com aba e formulários limpos. */
export function ProductDrawer({
  product,
  scope,
  run,
  canWrite,
  historical = false,
  onClose,
  onApplied,
}: {
  product: PricingProduct | null;
  scope: DrawerScope;
  run: PricingRunView | null;
  canWrite: boolean;
  historical?: boolean;
  onClose: () => void;
  /** Depois de um preço aplicado: o relatório precisa ser recalculado. */
  onApplied: () => void;
}) {
  return (
    <Sheet open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {product && <DrawerBody key={product.sku} product={product} scope={scope} run={run} canWrite={canWrite} historical={historical} onApplied={onApplied} />}
      </SheetContent>
    </Sheet>
  );
}
