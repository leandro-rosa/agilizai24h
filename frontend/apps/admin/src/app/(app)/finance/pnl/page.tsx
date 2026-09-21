"use client";

import { Info, Lock, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ORIGIN_LABELS,
  SECTION_LABELS,
  useComputePnlMutation,
  useGetPnlQuery,
  useGetPnlSeriesQuery,
  type AccountNode,
  type PnlView,
} from "@/lib/api/accounting";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useHasPermission } from "@/lib/auth/use-permission";
import { bps, currentPeriod, money, moneyCompact, period as fmtPeriod } from "@/lib/format";

const NETWORK = "network";
const NO_COMPARE = "none";

function findByCode(node: AccountNode, code: string): AccountNode | undefined {
  if (node.code === code) return node;
  for (const child of node.children) {
    const found = findByCode(child, code);
    if (found) return found;
  }
  return undefined;
}

function findAccount(view: PnlView, code: string): AccountNode | undefined {
  for (const section of view.sections) {
    for (const account of section.accounts) {
      const found = findByCode(account, code);
      if (found) return found;
    }
  }
  return undefined;
}

/** Só as folhas — uma conta-mãe (Deslocamento) é a soma das filhas, contá-la também dobraria a variação. */
function flattenLeaves(view: PnlView): AccountNode[] {
  const leaves: AccountNode[] = [];
  const walk = (node: AccountNode) => {
    if (node.children.length === 0) leaves.push(node);
    else node.children.forEach(walk);
  };
  view.sections.forEach((s) => s.accounts.forEach(walk));
  return leaves;
}

function pctOfNet(amountCents: number, netRevenueCents: number): number | null {
  return netRevenueCents > 0 ? (amountCents / netRevenueCents) * 100 : null;
}

function pctChange(curr: number, prev: number): number | null {
  return prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null;
}

function monthsBefore(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonth(period: string): string {
  return monthsBefore(period, 1);
}

function lastPeriods(n: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < n; i += 1) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return out;
}

/**
 * Frutas e coffee break são serviço à parte do minimercado (por isso nem
 * entram no DRE por loja) — e "Conveniência" é só a venda de loja, sem
 * mensalidade (que não tem CMV próprio). Pedido do operador 2026-09-18:
 * comparar a margem de cada operação, já que faturar mais não quer dizer
 * contribuir mais. Abaixo da margem bruta não há rateio por operação
 * definido ainda (deduções/despesas/resultado só existem consolidados).
 */
const OPERATIONS = [
  { key: "conveniencia", label: "Conveniência (lojas)", revenueCode: "3.1.01", cogsCode: "4.1.01" },
  { key: "frutas", label: "Frutas", revenueCode: "3.1.05", cogsCode: "4.1.03" },
  { key: "coffee", label: "Coffee break", revenueCode: "3.1.04", cogsCode: "4.1.02" },
] as const;

type OperationKey = (typeof OPERATIONS)[number]["key"] | "consolidada";

const EXPENSE_SECTIONS = new Set(["deductions", "cogs", "variable_expenses", "fixed_expenses", "financial_expenses"]);

export default function PnlPage() {
  // Chegada por link direto (ex: "Ações" em /finance/stores) já abre no
  // mês/loja certos — os dois são opcionais, e um valor ausente/inválido
  // cai no padrão de sempre (mês atual / rede).
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState(searchParams.get("period") ?? currentPeriod());
  const [scope, setScope] = useState<string>(searchParams.get("store_id") ?? NETWORK);
  const [comparePeriod, setComparePeriod] = useState<string>(previousMonth(period));
  const [operationTab, setOperationTab] = useState<OperationKey>("consolidada");

  const storeId = scope === NETWORK ? undefined : Number(scope);
  const { data, isLoading, error, refetch } = useGetPnlQuery({ period, storeId });
  const compareEnabled = comparePeriod !== NO_COMPARE;
  const { data: compareData } = useGetPnlQuery({ period: comparePeriod, storeId }, { skip: !compareEnabled });
  const { data: series } = useGetPnlSeriesQuery({ from: monthsBefore(period, 11), to: period, storeId });
  const { data: stores } = useGetStoresQuery();
  const [compute, { isLoading: computing }] = useComputePnlMutation();
  const canWrite = useHasPermission("accounting:write");

  const activeStores = (stores ?? []).filter((s) => s.status === "active").length;

  const operationData = useMemo(() => {
    if (!data) return [];
    return OPERATIONS.map(({ key, label, revenueCode, cogsCode }) => {
      const revenue = findAccount(data, revenueCode)?.amount_cents ?? 0;
      const cogs = findAccount(data, cogsCode)?.amount_cents ?? 0;
      const margin = revenue - cogs;
      const prevRevenue = compareData ? (findAccount(compareData, revenueCode)?.amount_cents ?? 0) : null;
      return {
        key,
        label,
        revenue,
        cogs,
        margin,
        marginPct: revenue > 0 ? (margin / revenue) * 100 : null,
        revenueTrendPct: prevRevenue !== null ? pctChange(revenue, prevRevenue) : null,
      };
    });
  }, [data, compareData]);

  const composicaoData = useMemo(() => {
    if (!data || data.totals.net_revenue_cents <= 0) return [];
    const t = data.totals;
    const slices = [
      { key: "cogs", label: "CMV", value: t.net_revenue_cents - t.gross_profit_cents, color: "var(--chart-1)" },
      { key: "fixas", label: "Despesas fixas", value: t.contribution_margin_cents - t.ebitda_cents, color: "var(--chart-2)" },
      { key: "variaveis", label: "Despesas variáveis", value: t.gross_profit_cents - t.contribution_margin_cents, color: "var(--chart-3)" },
      { key: "deducoes", label: "Impostos e taxas", value: t.gross_revenue_cents - t.net_revenue_cents, color: "var(--chart-4)" },
      { key: "financeiras", label: "Despesas financeiras", value: t.ebitda_cents - t.operating_profit_cents, color: "var(--chart-5)" },
    ].filter((s) => s.value > 0);
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    return slices.map((s) => ({ ...s, pct: (s.value / t.net_revenue_cents) * 100, shareOfTotalPct: total > 0 ? (s.value / total) * 100 : 0 }));
  }, [data]);

  const leitura = useMemo(() => {
    if (!data || !compareData || data.totals.net_revenue_cents <= 0) return [];
    const bullets: string[] = [];

    const revPct = pctChange(data.totals.net_revenue_cents, compareData.totals.net_revenue_cents);
    if (revPct !== null) {
      bullets.push(`Receita líquida ${revPct >= 0 ? "cresceu" : "caiu"} ${Math.abs(revPct).toFixed(1)}% em relação a ${fmtPeriod(comparePeriod)}.`);
    }

    const cogsPct = pctOfNet(data.totals.net_revenue_cents - data.totals.gross_profit_cents, data.totals.net_revenue_cents);
    const prevCogsPct = pctOfNet(compareData.totals.net_revenue_cents - compareData.totals.gross_profit_cents, compareData.totals.net_revenue_cents);
    if (cogsPct !== null && prevCogsPct !== null) {
      const deltaPP = cogsPct - prevCogsPct;
      bullets.push(`CMV representa ${cogsPct.toFixed(1)}% da receita (${deltaPP >= 0 ? "▲" : "▼"} ${Math.abs(deltaPP).toFixed(1)} p.p. vs. mês anterior).`);
    }

    const perdas = findAccount(data, "4.2.02")?.amount_cents ?? 0;
    const perdasPct = pctOfNet(perdas, data.totals.net_revenue_cents);
    const prevPerdas = findAccount(compareData, "4.2.02")?.amount_cents ?? 0;
    const prevPerdasPct = pctOfNet(prevPerdas, compareData.totals.net_revenue_cents);
    if (perdasPct !== null) {
      const ppText = prevPerdasPct !== null ? ` (${perdasPct - prevPerdasPct >= 0 ? "▲" : "▼"} ${Math.abs(perdasPct - prevPerdasPct).toFixed(1)} p.p.)` : "";
      bullets.push(`Perdas das lojas representam ${perdasPct.toFixed(1)}% da receita líquida${ppText}.`);
    }

    const deslocamento = findAccount(data, "4.2.03")?.amount_cents ?? 0;
    const deslocPct = pctOfNet(deslocamento, data.totals.net_revenue_cents);
    if (deslocPct !== null) bullets.push(`Deslocamento representa ${deslocPct.toFixed(1)}% da receita.`);

    const ebitdaPct = pctOfNet(data.totals.ebitda_cents, data.totals.net_revenue_cents);
    const prevEbitdaPct = pctOfNet(compareData.totals.ebitda_cents, compareData.totals.net_revenue_cents);
    if (ebitdaPct !== null && prevEbitdaPct !== null) {
      const deltaPP = ebitdaPct - prevEbitdaPct;
      bullets.push(`EBITDA de ${ebitdaPct.toFixed(1)}% (${deltaPP >= 0 ? "▲" : "▼"} ${Math.abs(deltaPP).toFixed(1)} p.p.).`);
    }

    const compareMap = new Map(flattenLeaves(compareData).map((n) => [n.code, n.amount_cents]));
    let biggest: { label: string; deltaPct: number } | null = null;
    for (const node of flattenLeaves(data)) {
      if (!EXPENSE_SECTIONS.has(node.section)) continue;
      const prev = compareMap.get(node.code) ?? 0;
      if (prev <= 0) continue;
      const deltaPct = ((node.amount_cents - prev) / prev) * 100;
      if (deltaPct > 0 && (!biggest || deltaPct > biggest.deltaPct)) biggest = { label: node.label, deltaPct };
    }
    if (biggest) bullets.push(`Principal aumento de despesa: ${biggest.label} (+${biggest.deltaPct.toFixed(0)}%).`);

    return bullets;
  }, [data, compareData, comparePeriod]);

  const variacoes = useMemo(() => {
    if (!data || !compareData) return null;
    const compareMap = new Map(flattenLeaves(compareData).map((n) => [n.code, n.amount_cents]));
    const deltas = flattenLeaves(data)
      .map((n) => {
        const prev = compareMap.get(n.code) ?? 0;
        const deltaCents = n.amount_cents - prev;
        return { label: n.label, deltaCents, deltaPct: pctChange(n.amount_cents, prev) };
      })
      .filter((d) => d.deltaCents !== 0);
    return {
      aumentos: deltas.filter((d) => d.deltaCents > 0).sort((a, b) => b.deltaCents - a.deltaCents).slice(0, 5),
      reducoes: deltas.filter((d) => d.deltaCents < 0).sort((a, b) => a.deltaCents - b.deltaCents).slice(0, 5),
    };
  }, [data, compareData]);

  async function close() {
    const result = await compute({ period, storeId, storeCount: activeStores, close: true })
      .unwrap()
      .catch(() => null);
    if (result) toast.success(`DRE de ${fmtPeriod(period)} fechado.`);
  }

  const emptyConfig: ChartConfig = {};

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="DRE"
        description="Receita, despesas e resultado do período. Acompanhe a evolução e entenda o que está puxando os números."
        actions={
          canWrite ? (
            <Button variant="outline" onClick={close} disabled={computing}>
              {data?.status === "closed" ? <Lock /> : <RefreshCw />}
              {computing ? "Apurando..." : data?.status === "closed" ? "Reapurar e fechar" : "Fechar o mês"}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lastPeriods(18).map((p) => (
              <SelectItem key={p} value={p}>
                {fmtPeriod(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">Comparar com</span>
        <Select value={comparePeriod} onValueChange={setComparePeriod}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_COMPARE}>Sem comparação</SelectItem>
            {lastPeriods(18)
              .filter((p) => p !== period)
              .map((p) => (
                <SelectItem key={p} value={p}>
                  {fmtPeriod(p)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NETWORK}>Rede (todas as lojas)</SelectItem>
            {(stores ?? []).map((store) => (
              <SelectItem key={store.id} value={String(store.id)}>
                {store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && (
          <StatusBadge tone={data.status === "closed" ? "positive" : "attention"} className="self-center">
            {data.status === "closed" ? "Fechado" : "Aberto"}
          </StatusBadge>
        )}
      </div>

      {scope === NETWORK && (
        <Tabs value={operationTab} onValueChange={(v) => setOperationTab(v as OperationKey)}>
          <TabsList>
            <TabsTrigger value="consolidada">Consolidada</TabsTrigger>
            {OPERATIONS.map((op) => (
              <TabsTrigger key={op.key} value={op.key}>
                {op.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {scope !== NETWORK && (
        <p className="text-sm text-muted-foreground">
          Contas marcadas <StatusBadge tone="attention">Rateado</StatusBadge> não têm lançamento próprio desta
          loja — são custo de rede estimado proporcionalmente à participação da loja na receita do período, não
          fato.
        </p>
      )}

      <RequestState isLoading={isLoading} error={error} onRetry={refetch} loadingRows={10}>
        {data && operationTab !== "consolidada" && (
          <OperationPanel spec={operationData.find((o) => o.key === operationTab)!} comparePeriod={compareEnabled ? comparePeriod : null} />
        )}

        {data && operationTab === "consolidada" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                label="Receita líquida"
                value={money(data.totals.net_revenue_cents)}
                trendPct={compareData ? pctChange(data.totals.net_revenue_cents, compareData.totals.net_revenue_cents) : null}
                comparePeriod={comparePeriod}
                legend="Receita bruta menos deduções (impostos sobre a venda, taxas de voucher, descontos, taxa da maquininha)."
              />
              <Kpi
                label="Margem de contribuição"
                value={money(data.totals.contribution_margin_cents)}
                subPct={pctOfNet(data.totals.contribution_margin_cents, data.totals.net_revenue_cents)}
                trendPP={
                  compareData
                    ? subPP(
                        pctOfNet(data.totals.contribution_margin_cents, data.totals.net_revenue_cents),
                        pctOfNet(compareData.totals.contribution_margin_cents, compareData.totals.net_revenue_cents),
                      )
                    : null
                }
                comparePeriod={comparePeriod}
                legend="Receita líquida menos CMV (custo do que foi vendido) e menos despesas variáveis (repasse, perdas, deslocamento, degustação, marketing)."
              />
              <Kpi
                label="EBITDA"
                value={money(data.totals.ebitda_cents)}
                tone={data.totals.ebitda_cents < 0 ? "critical" : "positive"}
                subPct={pctOfNet(data.totals.ebitda_cents, data.totals.net_revenue_cents)}
                trendPP={
                  compareData
                    ? subPP(pctOfNet(data.totals.ebitda_cents, data.totals.net_revenue_cents), pctOfNet(compareData.totals.ebitda_cents, compareData.totals.net_revenue_cents))
                    : null
                }
                comparePeriod={comparePeriod}
                legend="Margem de contribuição menos despesas fixas (mensalidade touchpay, contador, pró-labore, luz, ERP) — o resultado antes das despesas financeiras."
              />
              <Kpi
                label="Resultado líquido"
                value={money(data.totals.operating_profit_cents)}
                tone={data.totals.operating_profit_cents < 0 ? "critical" : "positive"}
                subPct={pctOfNet(data.totals.operating_profit_cents, data.totals.net_revenue_cents)}
                trendPct={compareData ? pctChange(data.totals.operating_profit_cents, compareData.totals.operating_profit_cents) : null}
                comparePeriod={comparePeriod}
                legend="EBITDA menos despesas financeiras (juros de empréstimo e de cheque especial/conta garantida) — o resultado final do mês: não há depreciação nem IR/CSLL segregados neste DRE."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Kpi
                label="Ponto de equilíbrio"
                /*
                 * -1 do serviço quer dizer INDEFINIDO, não zero: com margem de
                 * contribuição não-positiva nenhum volume de venda cobre o
                 * fixo. Mostrar "R$ 0,00" diria que já está no equilíbrio.
                 */
                value={data.totals.break_even_cents < 0 ? "—" : money(data.totals.break_even_cents)}
                hint={
                  data.totals.break_even_cents < 0
                    ? "Indefinido: a margem de contribuição não é positiva."
                    : undefined
                }
                legend="Quanto de receita líquida cobriria exatamente a despesa fixa, dada a margem de contribuição percentual do mês (despesa fixa ÷ margem de contribuição%)."
              />
              <Kpi
                label="Margem de segurança"
                value={bps(data.totals.safety_margin_bps)}
                tone={data.totals.safety_margin_bps < 0 ? "critical" : undefined}
                hint={
                  data.totals.safety_margin_bps < 0 ? "A receita está abaixo do ponto de equilíbrio." : undefined
                }
                legend="Quanto a receita líquida pode cair antes de bater o ponto de equilíbrio: (receita líquida − ponto de equilíbrio) ÷ receita líquida. Negativa quando já está abaixo dele."
              />
            </div>

            {leitura.length > 0 && (
              <Card className="border-l-4 border-l-primary">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-primary">Leitura de {fmtPeriod(period)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
                    {leitura.map((bullet, i) => (
                      <li key={i} className="text-sm">
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {((series && series.length > 0) || composicaoData.length > 0) && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {series && series.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-muted-foreground">Evolução da DRE</CardTitle>
                      <p className="text-xs text-muted-foreground">Últimos {series.length} meses fechados.</p>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={emptyConfig} className="h-72 w-full">
                        <LineChart
                          data={series.map((s) => ({
                            period: fmtPeriod(s.period),
                            receita: s.net_revenue_cents / 100,
                            margem: s.contribution_margin_cents / 100,
                            ebitda: s.ebitda_cents / 100,
                          }))}
                        >
                          <CartesianGrid vertical={false} stroke="var(--border)" />
                          <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                          <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => moneyCompact(v * 100)} />
                          <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Line type="monotone" dataKey="receita" name="Receita líquida" stroke="var(--primary)" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="margem" name="Margem de contribuição" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="ebitda" name="EBITDA" stroke="var(--success)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                )}

                {composicaoData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm font-medium text-muted-foreground">Composição dos gastos</CardTitle>
                      <p className="text-xs text-muted-foreground">% da receita líquida de {fmtPeriod(period)}.</p>
                    </CardHeader>
                    <CardContent className="flex items-center gap-4">
                      <ChartContainer config={emptyConfig} className="h-52 w-40 shrink-0">
                        <PieChart>
                          <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value))} />} />
                          <Pie data={composicaoData} dataKey="value" nameKey="label" innerRadius={40} outerRadius={70} strokeWidth={2}>
                            {composicaoData.map((s) => (
                              <Cell key={s.key} fill={s.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ChartContainer>
                      <ul className="flex flex-1 flex-col gap-2">
                        {composicaoData.map((s) => (
                          <li key={s.key} className="flex items-center justify-between gap-2 text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                              {s.label}
                            </span>
                            <span className="tabular font-medium">{s.pct.toFixed(1)}%</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">DRE detalhada</CardTitle>
                  <p className="text-xs text-muted-foreground">Valores e percentuais sobre a receita líquida.</p>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Conta</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead className="tabular text-right">{fmtPeriod(period)}</TableHead>
                        <TableHead className="tabular text-right">% Receita</TableHead>
                        {compareData && (
                          <>
                            <TableHead className="tabular text-right">{fmtPeriod(comparePeriod)}</TableHead>
                            <TableHead className="tabular text-right">% Receita</TableHead>
                            <TableHead className="tabular text-right">Var. R$</TableHead>
                            <TableHead className="tabular text-right">Var. %</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.sections.map((section) => (
                        <SectionRows
                          key={section.section}
                          section={section}
                          netRevenue={data.totals.net_revenue_cents}
                          compareView={compareData}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {variacoes && (variacoes.aumentos.length > 0 || variacoes.reducoes.length > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">Principais variações</CardTitle>
                    <p className="text-xs text-muted-foreground">vs. {fmtPeriod(comparePeriod)}.</p>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="aumentos">
                      <TabsList>
                        <TabsTrigger value="aumentos">Aumentos</TabsTrigger>
                        <TabsTrigger value="reducoes">Reduções</TabsTrigger>
                      </TabsList>
                      <TabsContent value="aumentos" className="flex flex-col gap-2 pt-2">
                        {variacoes.aumentos.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhum aumento relevante.</p>
                        ) : (
                          variacoes.aumentos.map((v) => <VariationRow key={v.label} icon={TrendingUp} {...v} />)
                        )}
                      </TabsContent>
                      <TabsContent value="reducoes" className="flex flex-col gap-2 pt-2">
                        {variacoes.reducoes.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhuma redução relevante.</p>
                        ) : (
                          variacoes.reducoes.map((v) => <VariationRow key={v.label} icon={TrendingDown} {...v} />)
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </RequestState>
    </div>
  );
}

function subPP(curr: number | null, prev: number | null): number | null {
  return curr !== null && prev !== null ? curr - prev : null;
}

function OperationPanel({
  spec,
  comparePeriod,
}: {
  spec: { label: string; revenue: number; cogs: number; margin: number; marginPct: number | null; revenueTrendPct: number | null };
  comparePeriod: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{spec.label}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Deduções, despesas e resultado abaixo da margem bruta não são segregados por operação — veja a aba
          Consolidada.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="text-sm text-muted-foreground">Receita bruta</p>
          <p className="tabular text-2xl font-semibold">{money(spec.revenue)}</p>
          {comparePeriod && spec.revenueTrendPct !== null && (
            <p className={`text-xs ${spec.revenueTrendPct >= 0 ? "text-success" : "text-destructive"}`}>
              {spec.revenueTrendPct >= 0 ? "▲" : "▼"} {Math.abs(spec.revenueTrendPct).toFixed(1)}% vs. {fmtPeriod(comparePeriod)}
            </p>
          )}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">CMV</p>
          <p className="tabular text-2xl font-semibold">({money(spec.cogs)})</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Margem bruta</p>
          <p className="tabular text-2xl font-semibold text-success">{money(spec.margin)}</p>
          <p className="text-xs text-muted-foreground">{spec.marginPct === null ? "—" : `${spec.marginPct.toFixed(1)}% da receita`}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function VariationRow({
  icon: Icon,
  label,
  deltaCents,
  deltaPct,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  deltaCents: number;
  deltaPct: number | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{label}</p>
      </div>
      <div className="text-right">
        <p className="tabular text-sm font-medium">
          {deltaCents >= 0 ? "+" : ""}
          {money(deltaCents)}
        </p>
        {deltaPct !== null && (
          <p className="text-xs text-muted-foreground">
            ({deltaPct >= 0 ? "+" : ""}
            {deltaPct.toFixed(1)}%)
          </p>
        )}
      </div>
    </div>
  );
}

function SectionRows({
  section,
  netRevenue,
  compareView,
}: {
  section: { section: string; amount_cents: number; accounts: AccountNode[] };
  netRevenue: number;
  compareView?: PnlView;
}) {
  const comparePct = pctOfNet(section.amount_cents, netRevenue);
  const compareSection = compareView?.sections.find((s) => s.section === section.section);
  return (
    <>
      <TableRow className="bg-muted/50">
        <TableCell colSpan={2} className="font-semibold">
          {SECTION_LABELS[section.section] ?? section.section}
        </TableCell>
        <TableCell className="tabular text-right font-semibold">{money(section.amount_cents)}</TableCell>
        <TableCell className="tabular text-right font-semibold">{comparePct === null ? "—" : `${comparePct.toFixed(1)}%`}</TableCell>
        {compareView && (
          <>
            <TableCell className="tabular text-right font-semibold">{money(compareSection?.amount_cents ?? 0)}</TableCell>
            <TableCell className="tabular text-right font-semibold">
              {pctOfNet(compareSection?.amount_cents ?? 0, compareView.totals.net_revenue_cents)?.toFixed(1) ?? "—"}%
            </TableCell>
            <TableCell className="tabular text-right font-semibold">
              {money(section.amount_cents - (compareSection?.amount_cents ?? 0))}
            </TableCell>
            <TableCell className="tabular text-right font-semibold">
              {pctChange(section.amount_cents, compareSection?.amount_cents ?? 0)?.toFixed(1) ?? "—"}%
            </TableCell>
          </>
        )}
      </TableRow>
      {section.accounts.map((account) => (
        <AccountRow key={account.id} node={account} depth={0} netRevenue={netRevenue} compareView={compareView} />
      ))}
    </>
  );
}

function AccountRow({
  node,
  depth,
  netRevenue,
  compareView,
}: {
  node: AccountNode;
  depth: number;
  netRevenue: number;
  compareView?: PnlView;
}) {
  const pct = pctOfNet(node.amount_cents, netRevenue);
  const compareNode = compareView ? findAccount(compareView, node.code) : undefined;
  const compareAmount = compareNode?.amount_cents ?? 0;
  const varCents = node.amount_cents - compareAmount;
  const varPct = pctChange(node.amount_cents, compareAmount);

  return (
    <>
      <TableRow>
        <TableCell style={{ paddingLeft: `${1 + depth * 1.5}rem` }}>
          <span className="text-sm">{node.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{node.code}</span>
        </TableCell>
        <TableCell>
          {node.allocated ? (
            // Estimativa por rateio (participação na receita), não um
            // lançamento real desta loja — nunca confundir com `origin`,
            // que só existe para lançamento real.
            <Tooltip>
              <TooltipTrigger asChild>
                <StatusBadge tone="attention" className="cursor-help">
                  Rateado
                </StatusBadge>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Custo de rede sem lançamento próprio desta loja — estimado proporcionalmente à participação da
                loja na receita do período. Não é fato, é estimativa.
              </TooltipContent>
            </Tooltip>
          ) : node.origin ? (
            // Rotular a origem é o que distingue FATO (veio de um serviço) de
            // PREMISSA (alguém digitou) — regra da raiz do repo.
            <StatusBadge tone={node.origin === "manual" ? "attention" : "neutral"}>
              {ORIGIN_LABELS[node.origin] ?? node.origin}
            </StatusBadge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="tabular text-right">
          {node.amount_cents === 0 ? <span className="text-muted-foreground">—</span> : money(node.amount_cents)}
        </TableCell>
        <TableCell className="tabular text-right text-muted-foreground">{pct === null ? "—" : `${pct.toFixed(1)}%`}</TableCell>
        {compareView && (
          <>
            <TableCell className="tabular text-right">
              {compareAmount === 0 ? <span className="text-muted-foreground">—</span> : money(compareAmount)}
            </TableCell>
            <TableCell className="tabular text-right text-muted-foreground">
              {pctOfNet(compareAmount, compareView.totals.net_revenue_cents)?.toFixed(1) ?? "—"}%
            </TableCell>
            <TableCell className={`tabular text-right ${varCents === 0 ? "text-muted-foreground" : ""}`}>
              {varCents === 0 ? "—" : `${varCents > 0 ? "+" : ""}${money(varCents)}`}
            </TableCell>
            <TableCell className="tabular text-right text-muted-foreground">{varPct === null ? "—" : `${varPct > 0 ? "+" : ""}${varPct.toFixed(1)}%`}</TableCell>
          </>
        )}
      </TableRow>
      {node.children.map((child) => (
        <AccountRow key={child.id} node={child} depth={depth + 1} netRevenue={netRevenue} compareView={compareView} />
      ))}
    </>
  );
}

function Kpi({
  label,
  value,
  tone,
  hint,
  legend,
  subPct,
  trendPct,
  trendPP,
  comparePeriod,
}: {
  label: string;
  value: string;
  tone?: "positive" | "critical";
  hint?: string;
  legend?: string;
  /** % da receita líquida, mostrado como subtítulo (ex.: margens/EBITDA). */
  subPct?: number | null;
  /** Variação percentual vs. `comparePeriod` (para valores em R$). */
  trendPct?: number | null;
  /** Variação em pontos percentuais vs. `comparePeriod` (para indicadores que já são %). */
  trendPP?: number | null;
  comparePeriod?: string;
}) {
  const color = tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : "";
  const trend = trendPct !== undefined && trendPct !== null ? { value: trendPct, suffix: "%" } : trendPP !== undefined && trendPP !== null ? { value: trendPP, suffix: " p.p." } : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {label}
          {legend && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3.5 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{legend}</TooltipContent>
            </Tooltip>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-2xl font-semibold ${color}`}>{value}</p>
        {subPct !== undefined && subPct !== null && <p className="mt-1 text-xs text-muted-foreground">{subPct.toFixed(1)}% da receita</p>}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        {trend && comparePeriod && (
          <p className={`mt-1 text-xs ${trend.value >= 0 ? "text-success" : "text-destructive"}`}>
            {trend.value >= 0 ? "▲" : "▼"} {Math.abs(trend.value).toFixed(1)}
            {trend.suffix} vs. {fmtPeriod(comparePeriod)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
