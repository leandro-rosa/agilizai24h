"use client";

import {
  AlertTriangle,
  Download,
  Landmark,
  Percent,
  PiggyBank,
  Search,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { ColumnValueFilter } from "@/components/column-value-filter";
import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGetPnlByStoreQuery, type StorePnlSummary } from "@/lib/api/accounting";
import { useGetSitesQuery } from "@/lib/api/billing";
import { useGetStoresQuery, type Store } from "@/lib/api/stores";
import { currentPeriod, money, moneyCompact, period as fmtPeriod } from "@/lib/format";
import { monthsInRange, presetRange } from "@/lib/period-range";
import {
  analyzeStores,
  clientResultOf,
  COVERAGE_HEALTHY,
  COVERAGE_WATCH,
  LOSS_THRESHOLD_PCT,
  marginOf,
  resultOf,
  type ClientTotals,
  type InsightSeverity,
  type View,
} from "@/lib/store-insights";

const NUMERIC_KEYS = [
  "gross_revenue_cents",
  "net_revenue_cents",
  "cogs_cents",
  "contribution_margin_cents",
  "operating_profit_cents",
  "mensalidade_cents",
  "perdas_cents",
  "allocated_cents",
  "operating_profit_before_allocation_cents",
  "admin_allocated_cents",
  "contribution_margin_excl_admin_cents",
  "operating_profit_excl_admin_cents",
] as const;

function lastPeriods(n: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < n; i += 1) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return out;
}

function previousMonth(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, month - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Média simples por loja através de 1-3 meses — uma loja sem dado num mês não penaliza a média (divide só pelos meses em que existiu). */
function averageSummaries(lists: StorePnlSummary[][]): StorePnlSummary[] {
  const byStore = new Map<number, StorePnlSummary[]>();
  for (const list of lists) {
    for (const row of list) {
      byStore.set(row.store_id, [...(byStore.get(row.store_id) ?? []), row]);
    }
  }
  return [...byStore.entries()].map(([store_id, rows]) => {
    const avg = { store_id } as StorePnlSummary;
    for (const key of NUMERIC_KEYS) {
      avg[key] = Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length);
    }
    return avg;
  });
}

/** "Ascenty - HTL05" -> "Ascenty"; "Plena Saude - Taipas" -> "Plena Saude"; "Rolls-Royce" -> "Rolls-Royce". */
function clientOf(storeName: string | undefined): string {
  if (!storeName) return "—";
  const dash = storeName.indexOf(" - ");
  return dash === -1 ? storeName : storeName.slice(0, dash);
}

/** "Ascenty - Franco da Rocha" -> "Franco da Rocha" — nome curto pro eixo do gráfico, sem repetir o cliente 20x. */
function shortName(storeName: string | undefined, storeId: number): string {
  if (!storeName) return `Loja ${storeId}`;
  const dash = storeName.indexOf(" - ");
  return dash === -1 ? storeName : storeName.slice(dash + 3);
}

type Tone = "success" | "warning" | "critical";

function resultTone(resultCents: number, grossRevenueCents: number): Tone {
  if (resultCents < 0) return "critical";
  if (grossRevenueCents > 0 && resultCents / grossRevenueCents < 0.05) return "warning";
  return "success";
}

const TONE_VAR: Record<Tone, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--destructive)",
};

type Status = "saudavel" | "atencao" | "critica" | "ramp_up" | "positiva_nao_absorve";

const STATUS_LABEL: Record<Status, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  critica: "Crítica",
  ramp_up: "Em ramp-up",
  positiva_nao_absorve: "Positiva na operação",
};

const STATUS_TONE: Record<Status, "positive" | "attention" | "critical" | "neutral"> = {
  saudavel: "positive",
  atencao: "attention",
  critica: "critical",
  ramp_up: "neutral",
  positiva_nao_absorve: "attention",
};

/**
 * Com rateio: uma loja que só fica negativa DEPOIS do pacote administrativo
 * não é "Crítica" — é saudável na própria operação e só não absorve a
 * fatia da estrutura, um problema diferente (e uma ação diferente) de uma
 * loja que já nasce no vermelho. Pedido do operador 2026-09-18: nunca
 * rotular as duas do mesmo jeito.
 */
function computeStatus(row: StorePnlSummary, store: Store | undefined, anchorPeriod: string, view: View): Status {
  if (store?.opened_on) {
    const openedAt = new Date(store.opened_on);
    const anchor = new Date(`${anchorPeriod}-01T00:00:00`);
    const ageDays = (anchor.getTime() - openedAt.getTime()) / 86_400_000;
    if (ageDays >= 0 && ageDays < 60) return "ramp_up";
  }
  const perdasPct = row.gross_revenue_cents > 0 ? (row.perdas_cents / row.gross_revenue_cents) * 100 : 0;
  const result = resultOf(row, view);
  if (view === "post" && result < 0 && row.operating_profit_excl_admin_cents >= 0) return "positiva_nao_absorve";
  if (result < 0) return "critica";
  if (perdasPct > LOSS_THRESHOLD_PCT) return "atencao";
  return "saudavel";
}

/** Pra filtro/contagem de pílula: "Em ramp-up"/"Positiva na operação" entram junto de "Atenção" — nem saudável nem crítica. O badge da linha continua distinguindo os três. */
function statusBucket(status: Status): "saudavel" | "atencao" | "critica" {
  return status === "ramp_up" || status === "positiva_nao_absorve" ? "atencao" : status;
}

function downloadCsv(
  rows: StorePnlSummary[],
  storeById: Map<number, Store>,
  period: string,
  view: View,
  employeesByStore: Map<number, number>,
) {
  const header =
    view === "pre"
      ? ["Loja", "Funcionários", "Vendas", "CMV", "Perdas %", "Mensalidade", "Margem de contribuição", "Margem %", "Resultado operacional"]
      : ["Loja", "Funcionários", "Vendas", "CMV", "Perdas %", "Mensalidade", "Margem de contribuição", "Margem %", "Rateio administrativo", "Resultado após rateio"];
  const lines = rows.map((row) => {
    const perdasPct = row.gross_revenue_cents > 0 ? (row.perdas_cents / row.gross_revenue_cents) * 100 : 0;
    const marginPct = row.gross_revenue_cents > 0 ? (marginOf(row, view) / row.gross_revenue_cents) * 100 : null;
    const employees = employeesByStore.get(row.store_id);
    const cells =
      view === "pre"
        ? [
            storeById.get(row.store_id)?.name ?? `Loja ${row.store_id}`,
            employees ?? "",
            (row.gross_revenue_cents / 100).toFixed(2),
            (row.cogs_cents / 100).toFixed(2),
            perdasPct.toFixed(1),
            (row.mensalidade_cents / 100).toFixed(2),
            (marginOf(row, view) / 100).toFixed(2),
            marginPct === null ? "" : marginPct.toFixed(1),
            (resultOf(row, view) / 100).toFixed(2),
          ]
        : [
            storeById.get(row.store_id)?.name ?? `Loja ${row.store_id}`,
            employees ?? "",
            (row.gross_revenue_cents / 100).toFixed(2),
            (row.cogs_cents / 100).toFixed(2),
            perdasPct.toFixed(1),
            (row.mensalidade_cents / 100).toFixed(2),
            (marginOf(row, view) / 100).toFixed(2),
            marginPct === null ? "" : marginPct.toFixed(1),
            (row.admin_allocated_cents / 100).toFixed(2),
            (resultOf(row, view) / 100).toFixed(2),
          ];
    return cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";");
  });
  const csv = [header.join(";"), ...lines].join("\n");
  const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resultado-por-loja-${view}-${period}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface KpiCardSpec {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "positive" | "critical";
  trendPct?: number | null;
}

/**
 * Filtro por coluna — pedido do operador 2026-09-18 (correção de uma
 * primeira versão por faixa min/máx): "quero filtrar funcionários e ver
 * todas as lojas com 50 funcionários, ou todas as lojas da Ascenty". Ou
 * seja, escolher VALORES exatos por coluna (tipo AutoFilter de planilha),
 * não uma faixa contínua. `extract` devolve o valor daquela loja pra essa
 * coluna — `key` é o que entra no Set de seleção (sempre a partir de um
 * inteiro em centavos ou já arredondado, nunca duas casas de float
 * "iguais" que na verdade divergem na 3ª casa), `label` é o texto
 * mostrado no seletor. `null` = a loja não tem valor nessa coluna (não
 * participa da lista de opções nem é afetada por um filtro nela).
 */
interface ColumnValue {
  key: string;
  label: string;
}

interface FilterContext {
  view: View;
  storeById: Map<number, Store>;
  employeesByStore: Map<number, number>;
}

type FilterColumnKey =
  | "cliente"
  | "funcionarios"
  | "vendas"
  | "cmv"
  | "perdas_pct"
  | "mensalidade"
  | "margem"
  | "margem_pct"
  | "rateio"
  | "cobertura"
  | "resultado";

interface FilterColumnSpec {
  key: FilterColumnKey;
  label: string;
  /** Só faz sentido na visão Com rateio (rateio administrativo/cobertura). */
  postOnly?: boolean;
  extract: (row: StorePnlSummary, ctx: FilterContext) => ColumnValue | null;
}

const FILTER_COLUMNS: FilterColumnSpec[] = [
  {
    key: "cliente",
    label: "Cliente",
    extract: (row, { storeById }) => {
      const client = clientOf(storeById.get(row.store_id)?.name);
      return { key: client, label: client };
    },
  },
  {
    key: "funcionarios",
    label: "Funcionários",
    extract: (row, { employeesByStore }) => {
      const value = employeesByStore.get(row.store_id);
      return value === undefined ? null : { key: String(value), label: String(value) };
    },
  },
  {
    key: "vendas",
    label: "Vendas",
    extract: (row) => ({ key: String(row.gross_revenue_cents), label: money(row.gross_revenue_cents) }),
  },
  {
    key: "cmv",
    label: "CMV",
    extract: (row) => ({ key: String(row.cogs_cents), label: money(row.cogs_cents) }),
  },
  {
    key: "perdas_pct",
    label: "Perdas %",
    extract: (row) => {
      const pct = row.gross_revenue_cents > 0 ? Math.round((row.perdas_cents / row.gross_revenue_cents) * 1000) / 10 : 0;
      return { key: String(pct), label: `${pct.toFixed(1)}%` };
    },
  },
  {
    key: "mensalidade",
    label: "Mensalidade",
    extract: (row) => ({
      key: String(row.mensalidade_cents),
      label: row.mensalidade_cents === 0 ? "—" : money(row.mensalidade_cents),
    }),
  },
  {
    key: "margem",
    label: "Margem contrib.",
    extract: (row, { view }) => {
      const cents = marginOf(row, view);
      return { key: String(cents), label: money(cents) };
    },
  },
  {
    key: "margem_pct",
    label: "Margem %",
    extract: (row, { view }) => {
      if (row.gross_revenue_cents <= 0) return null;
      const pct = Math.round((marginOf(row, view) / row.gross_revenue_cents) * 1000) / 10;
      return { key: String(pct), label: `${pct.toFixed(1)}%` };
    },
  },
  {
    key: "rateio",
    label: "Rateio",
    postOnly: true,
    extract: (row) => ({ key: String(row.admin_allocated_cents), label: money(row.admin_allocated_cents) }),
  },
  {
    key: "cobertura",
    label: "Cobertura",
    postOnly: true,
    extract: (row) => {
      if (row.admin_allocated_cents <= 0) return null;
      const ratio = Math.round((row.contribution_margin_excl_admin_cents / row.admin_allocated_cents) * 10) / 10;
      return { key: String(ratio), label: `${ratio.toFixed(1)}×` };
    },
  },
  {
    key: "resultado",
    label: "Resultado",
    extract: (row, { view }) => {
      const cents = resultOf(row, view);
      return { key: String(cents), label: money(cents) };
    },
  },
];

/** Referência estável — um `new Set()` novo a cada render quebraria a comparação de `selected.size` sem motivo. */
const EMPTY_SELECTION = new Set<string>();

/**
 * Painel de decisão para todas as lojas de uma vez — pedido do operador
 * 2026-09-18. Camada superior (KPIs, gráficos, alertas) responde "onde
 * ganho dinheiro e onde preciso agir"; a tabela detalhada continua embaixo
 * pra quem quer conferir linha a linha.
 *
 * O filtro "Sem rateio × Com rateio" (pedido do operador 2026-09-18) decide
 * o que conta como resultado da loja: Sem rateio é só a operação dela
 * (Deslocamento/Repasse continuam contando — são custo real dela, só com
 * driver próprio); Com rateio soma também o pacote administrativo de rede
 * (contador, pró-labore, sistema, ERP, juros, marketing/degustações).
 * "Sem rateio" responde "essa loja é uma boa operação?"; "Com rateio"
 * responde "essa loja sustenta sua fatia da empresa?" — nunca a mesma
 * pergunta.
 */
export default function StoresDashboardPage() {
  const [basePeriod, setBasePeriod] = useState(currentPeriod());
  const [view, setView] = useState<View>("pre");
  const [mode, setMode] = useState<"month" | "avg3">("month");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todas" | "saudavel" | "atencao" | "critica">("todas");
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterColumnKey, Set<string>>>>({});

  const avg3Periods = useMemo(() => monthsInRange(presetRange("quarter", basePeriod)), [basePeriod]);

  const monthQuery = useGetPnlByStoreQuery({ period: basePeriod });
  const avg3Query0 = useGetPnlByStoreQuery({ period: avg3Periods[0] }, { skip: mode !== "avg3" });
  const avg3Query1 = useGetPnlByStoreQuery({ period: avg3Periods[1] }, { skip: mode !== "avg3" });
  const previousMonthQuery = useGetPnlByStoreQuery({ period: previousMonth(basePeriod) }, { skip: mode !== "month" });

  const { data: stores } = useGetStoresQuery();
  const storeById = useMemo(() => new Map((stores ?? []).map((s) => [s.id, s])), [stores]);

  const { data: sites } = useGetSitesQuery();
  /** Nº de pessoas do cliente naquela unidade (`client_site.employees`, painel comercial) — proxy de demanda potencial da loja, não headcount da Agiliz (as lojas são autônomas, sem operador). */
  const employeesByStore = useMemo(() => {
    const map = new Map<number, number>();
    for (const site of sites ?? []) {
      if (site.store_id !== null && site.employees !== null) map.set(site.store_id, site.employees);
    }
    return map;
  }, [sites]);

  const isLoading =
    mode === "month" ? monthQuery.isLoading : monthQuery.isLoading || avg3Query0.isLoading || avg3Query1.isLoading;
  const error = monthQuery.error ?? avg3Query0.error ?? avg3Query1.error;
  const refetch = () => {
    monthQuery.refetch();
    if (mode === "avg3") {
      avg3Query0.refetch();
      avg3Query1.refetch();
    }
  };

  const rawSummaries = useMemo(() => {
    if (mode === "month") return monthQuery.data ?? [];
    const lists = [avg3Query0.data, avg3Query1.data, monthQuery.data].filter((l): l is StorePnlSummary[] => !!l);
    return averageSummaries(lists);
  }, [mode, monthQuery.data, avg3Query0.data, avg3Query1.data]);

  const rows = useMemo(
    () => [...rawSummaries].sort((a, b) => resultOf(b, view) - resultOf(a, view)),
    [rawSummaries, view],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          gross_revenue_cents: acc.gross_revenue_cents + row.gross_revenue_cents,
          cogs_cents: acc.cogs_cents + row.cogs_cents,
          margin_cents: acc.margin_cents + marginOf(row, view),
          admin_allocated_cents: acc.admin_allocated_cents + row.admin_allocated_cents,
          result_cents: acc.result_cents + resultOf(row, view),
        }),
        { gross_revenue_cents: 0, cogs_cents: 0, margin_cents: 0, admin_allocated_cents: 0, result_cents: 0 },
      ),
    [rows, view],
  );

  const previousTotals = useMemo(() => {
    if (mode !== "month" || !previousMonthQuery.data) return null;
    return previousMonthQuery.data.reduce(
      (acc, row) => ({
        gross_revenue_cents: acc.gross_revenue_cents + row.gross_revenue_cents,
        result_cents: acc.result_cents + resultOf(row, view),
      }),
      { gross_revenue_cents: 0, result_cents: 0 },
    );
  }, [mode, previousMonthQuery.data, view]);

  const revenueTrendPct =
    previousTotals && previousTotals.gross_revenue_cents > 0
      ? ((totals.gross_revenue_cents - previousTotals.gross_revenue_cents) / previousTotals.gross_revenue_cents) * 100
      : null;
  const resultTrendPct =
    previousTotals && previousTotals.result_cents !== 0
      ? ((totals.result_cents - previousTotals.result_cents) / Math.abs(previousTotals.result_cents)) * 100
      : null;

  const negativeCount = rows.filter((r) => resultOf(r, view) < 0).length;
  const marginOnSales = totals.gross_revenue_cents > 0 ? (totals.result_cents / totals.gross_revenue_cents) * 100 : 0;

  const medianRevenue = useMemo(() => {
    if (rows.length === 0) return 0;
    const sorted = [...rows].map((r) => r.gross_revenue_cents).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }, [rows]);

  const coverageOf = (row: StorePnlSummary) =>
    row.admin_allocated_cents > 0 ? row.contribution_margin_excl_admin_cents / row.admin_allocated_cents : null;

  const statusByStore = useMemo(() => {
    const map = new Map<number, Status>();
    for (const row of rows) map.set(row.store_id, computeStatus(row, storeById.get(row.store_id), basePeriod, view));
    return map;
  }, [rows, storeById, basePeriod, view]);

  const statusCounts = useMemo(() => {
    const counts = { saudavel: 0, atencao: 0, critica: 0 };
    for (const row of rows) counts[statusBucket(statusByStore.get(row.store_id)!)] += 1;
    return counts;
  }, [rows, statusByStore]);

  const filterContext: FilterContext = useMemo(
    () => ({ view, storeById, employeesByStore }),
    [view, storeById, employeesByStore],
  );

  /** Opções reais (com contagem) de cada coluna filtrável, a partir das lojas do período atual — nunca uma lista fixa que poderia sugerir um valor que não existe. */
  const columnOptions = useMemo(() => {
    const result = new Map<FilterColumnKey, Map<string, { label: string; count: number }>>();
    for (const col of FILTER_COLUMNS) {
      if (col.postOnly && view !== "post") continue;
      const options = new Map<string, { label: string; count: number }>();
      for (const row of rows) {
        const value = col.extract(row, filterContext);
        if (!value) continue;
        const existing = options.get(value.key);
        if (existing) existing.count += 1;
        else options.set(value.key, { label: value.label, count: 1 });
      }
      result.set(col.key, options);
    }
    return result;
  }, [rows, view, filterContext]);

  const activeColumnFilterCount = Object.values(columnFilters).filter((set) => set && set.size > 0).length;

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const name = storeById.get(row.store_id)?.name ?? "";
      if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== "todas" && statusBucket(statusByStore.get(row.store_id)!) !== statusFilter) return false;

      for (const col of FILTER_COLUMNS) {
        const selected = columnFilters[col.key];
        if (!selected || selected.size === 0) continue;
        const value = col.extract(row, filterContext);
        if (!value || !selected.has(value.key)) return false;
      }
      return true;
    });
  }, [rows, storeById, search, statusFilter, statusByStore, columnFilters, filterContext]);

  const byClient = useMemo(() => {
    const groups = new Map<string, ClientTotals>();
    for (const row of rows) {
      const client = clientOf(storeById.get(row.store_id)?.name);
      const g = groups.get(client) ?? {
        gross_revenue_cents: 0,
        contribution_margin_cents: 0,
        contribution_margin_excl_admin_cents: 0,
        admin_allocated_cents: 0,
        operating_profit_cents: 0,
        operating_profit_excl_admin_cents: 0,
        storeCount: 0,
      };
      g.gross_revenue_cents += row.gross_revenue_cents;
      g.contribution_margin_cents += row.contribution_margin_cents;
      g.contribution_margin_excl_admin_cents += row.contribution_margin_excl_admin_cents;
      g.admin_allocated_cents += row.admin_allocated_cents;
      g.operating_profit_cents += row.operating_profit_cents;
      g.operating_profit_excl_admin_cents += row.operating_profit_excl_admin_cents;
      g.storeCount += 1;
      groups.set(client, g);
    }
    return [...groups.entries()].sort((a, b) => clientResultOf(b[1], view) - clientResultOf(a[1], view));
  }, [rows, storeById, view]);

  const insights = useMemo(
    () => analyzeStores(rows, previousMonthQuery.data, storeById, byClient, view),
    [rows, previousMonthQuery.data, storeById, byClient, view],
  );

  const resultChartData = useMemo(
    () =>
      rows.map((row) => {
        const resultado = resultOf(row, view);
        return {
          store_id: row.store_id,
          name: shortName(storeById.get(row.store_id)?.name, row.store_id),
          resultado: resultado / 100,
          tone: resultTone(resultado, row.gross_revenue_cents),
        };
      }),
    [rows, storeById, view],
  );

  const scatterData = useMemo(
    () =>
      rows.map((row) => {
        const resultado = resultOf(row, view);
        const highRevenue = row.gross_revenue_cents >= medianRevenue;
        const positive = resultado >= 0;
        const tone: Tone = !positive ? "critical" : highRevenue ? "success" : "warning";
        return {
          store_id: row.store_id,
          name: shortName(storeById.get(row.store_id)?.name, row.store_id),
          vendas: row.gross_revenue_cents / 100,
          resultado: resultado / 100,
          tone,
        };
      }),
    [rows, storeById, medianRevenue, view],
  );

  const scatterBounds = useMemo(() => {
    const maxRevenue = Math.max(medianRevenue / 100, ...scatterData.map((d) => d.vendas), 1) * 1.15;
    const maxResult = Math.max(0, ...scatterData.map((d) => d.resultado)) * 1.2 || 1;
    const minResult = Math.min(0, ...scatterData.map((d) => d.resultado)) * 1.2;
    return { maxRevenue, maxResult, minResult };
  }, [scatterData, medianRevenue]);

  /** Funcionários do cliente × resultado — pedido do operador 2026-09-18, pra achar a faixa de funcionários que sustenta um bom resultado. Só entram lojas com o dado cadastrado no painel comercial. */
  const employeesChartData = useMemo(
    () =>
      rows
        .filter((row) => employeesByStore.has(row.store_id))
        .map((row) => {
          const resultado = resultOf(row, view);
          return {
            store_id: row.store_id,
            name: shortName(storeById.get(row.store_id)?.name, row.store_id),
            funcionarios: employeesByStore.get(row.store_id)!,
            resultado: resultado / 100,
            tone: resultTone(resultado, row.gross_revenue_cents),
          };
        }),
    [rows, storeById, view, employeesByStore],
  );

  const employeesChartBounds = useMemo(() => {
    const maxFuncionarios = Math.max(...employeesChartData.map((d) => d.funcionarios), 1) * 1.15;
    const maxResult = Math.max(0, ...employeesChartData.map((d) => d.resultado)) * 1.2 || 1;
    const minResult = Math.min(0, ...employeesChartData.map((d) => d.resultado)) * 1.2;
    return { maxFuncionarios, maxResult, minResult };
  }, [employeesChartData]);

  const perdasChartData = useMemo(
    () =>
      [...rows]
        .map((row) => ({
          store_id: row.store_id,
          name: shortName(storeById.get(row.store_id)?.name, row.store_id),
          pct: row.gross_revenue_cents > 0 ? (row.perdas_cents / row.gross_revenue_cents) * 100 : 0,
        }))
        .sort((a, b) => b.pct - a.pct),
    [rows, storeById],
  );

  const coverageChartData = useMemo(
    () =>
      [...rows]
        .map((row) => ({
          store_id: row.store_id,
          name: shortName(storeById.get(row.store_id)?.name, row.store_id),
          coverage: coverageOf(row),
        }))
        .filter((d): d is { store_id: number; name: string; coverage: number } => d.coverage !== null)
        .sort((a, b) => b.coverage - a.coverage),
    [rows, storeById],
  );

  const emptyConfig: ChartConfig = {};

  const kpiCards: KpiCardSpec[] =
    view === "pre"
      ? [
          { key: "faturamento", icon: TrendingUp, label: "Faturamento", value: money(totals.gross_revenue_cents), trendPct: revenueTrendPct },
          { key: "margem", icon: PiggyBank, label: "Margem de contribuição", value: money(totals.margin_cents) },
          {
            key: "resultado",
            icon: Wallet,
            label: "Resultado operacional",
            value: money(totals.result_cents),
            tone: totals.result_cents < 0 ? "critical" : "positive",
            trendPct: resultTrendPct,
          },
          { key: "margem-op", icon: Percent, label: "Margem operacional", value: `${marginOnSales.toFixed(1)}%` },
          {
            key: "negativas",
            icon: AlertTriangle,
            label: "Lojas negativas",
            value: `${negativeCount} de ${rows.length}`,
            tone: negativeCount > 0 ? "critical" : "positive",
          },
        ]
      : [
          { key: "faturamento", icon: TrendingUp, label: "Faturamento", value: money(totals.gross_revenue_cents), trendPct: revenueTrendPct },
          { key: "margem", icon: PiggyBank, label: "Margem de contribuição", value: money(totals.margin_cents) },
          { key: "estrutura", icon: Landmark, label: "Estrutura rateada", value: money(totals.admin_allocated_cents), tone: "critical" },
          {
            key: "resultado",
            icon: Wallet,
            label: "Resultado após rateio",
            value: money(totals.result_cents),
            tone: totals.result_cents < 0 ? "critical" : "positive",
            trendPct: resultTrendPct,
          },
          { key: "margem-op", icon: Percent, label: "Margem após rateio", value: `${marginOnSales.toFixed(1)}%` },
          {
            key: "negativas",
            icon: AlertTriangle,
            label: "Lojas abaixo de zero",
            value: `${negativeCount} de ${rows.length}`,
            tone: negativeCount > 0 ? "critical" : "positive",
          },
        ];

  const detailColSpan = view === "post" ? 13 : 11;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Resultado por loja"
        description="Analise a performance individual de cada loja e o impacto da estrutura administrativa da rede."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={basePeriod} onValueChange={setBasePeriod}>
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
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList>
                <TabsTrigger value="pre">Sem rateio</TabsTrigger>
                <TabsTrigger value="post">Com rateio</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={mode} onValueChange={(v) => setMode(v as "month" | "avg3")}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Só este mês</SelectItem>
                <SelectItem value="avg3">Média últimos 3 meses</SelectItem>
              </SelectContent>
            </Select>
            {rows.length > 0 && (
              <Button variant="outline" onClick={() => downloadCsv(rows, storeById, basePeriod, view, employeesByStore)}>
                <Download /> Exportar
              </Button>
            )}
          </div>
        }
      />

      <RequestState isLoading={isLoading} error={error} onRetry={refetch} loadingRows={10}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma loja com receita lançada neste período.</p>
        ) : (
          <>
            {/* KPIs */}
            <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${view === "pre" ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}>
              {kpiCards.map((card) => (
                <Kpi key={card.key} icon={card.icon} label={card.label} value={card.value} tone={card.tone} trendPct={card.trendPct} />
              ))}
            </div>

            {/* Gráfico principal */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {view === "pre" ? "Resultado operacional por loja" : "Resultado por loja após rateio"} —{" "}
                  {mode === "avg3" ? "média 3 meses" : fmtPeriod(basePeriod)}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {view === "pre"
                    ? "Resultado da operação de cada loja, sem a estrutura administrativa de rede."
                    : "Resultado após o rateio da estrutura administrativa, ordenado do maior para o menor."}
                </p>
              </CardHeader>
              <CardContent>
                <ChartContainer config={emptyConfig} className="w-full" style={{ height: Math.max(360, rows.length * 28) }}>
                  <BarChart data={resultChartData} layout="vertical" margin={{ left: 24, right: 56 }}>
                    <CartesianGrid horizontal={false} stroke="var(--border)" />
                    <XAxis
                      type="number"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)" }}
                      tickFormatter={(value: number) => moneyCompact(value * 100)}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={110}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <ReferenceLine x={0} stroke="var(--border)" />
                    <ChartTooltip content={<ChartTooltipContent formatter={(value) => money(Number(value) * 100)} />} />
                    <Bar dataKey="resultado" radius={4}>
                      {resultChartData.map((d) => (
                        <Cell key={d.store_id} fill={TONE_VAR[d.tone]} />
                      ))}
                      <LabelList
                        dataKey="resultado"
                        position="right"
                        formatter={(value: unknown) => moneyCompact(Number(value) * 100)}
                        fontSize={10}
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Matriz de saúde */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Matriz de saúde das lojas</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Cada ponto é uma loja — vendas × resultado {view === "pre" ? "da operação" : "após o rateio administrativo"}.
                </p>
              </CardHeader>
              <CardContent>
                <ChartContainer config={emptyConfig} className="h-96 w-full">
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis
                      type="number"
                      dataKey="vendas"
                      name="Vendas"
                      domain={[0, scatterBounds.maxRevenue]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)" }}
                      tickFormatter={(value: number) => moneyCompact(value * 100)}
                    />
                    <YAxis
                      type="number"
                      dataKey="resultado"
                      name="Resultado"
                      domain={[scatterBounds.minResult, scatterBounds.maxResult]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)" }}
                      tickFormatter={(value: number) => moneyCompact(value * 100)}
                    />
                    <ZAxis range={[90, 90]} />

                    <ReferenceArea
                      x1={medianRevenue / 100}
                      x2={scatterBounds.maxRevenue}
                      y1={0}
                      y2={scatterBounds.maxResult}
                      fill="var(--success)"
                      fillOpacity={0.06}
                      label={{ value: "Lojas fortes", position: "insideTopRight", fontSize: 10, fill: "var(--success)" }}
                    />
                    <ReferenceArea
                      x1={0}
                      x2={medianRevenue / 100}
                      y1={0}
                      y2={scatterBounds.maxResult}
                      fill="var(--chart-4)"
                      fillOpacity={0.06}
                      label={{ value: "Otimizar e crescer", position: "insideTopLeft", fontSize: 10, fill: "var(--chart-4)" }}
                    />
                    <ReferenceArea
                      x1={medianRevenue / 100}
                      x2={scatterBounds.maxRevenue}
                      y1={scatterBounds.minResult}
                      y2={0}
                      fill="var(--warning)"
                      fillOpacity={0.06}
                      label={{ value: "Investigar margem/perdas", position: "insideBottomRight", fontSize: 10, fill: "var(--warning)" }}
                    />
                    <ReferenceArea
                      x1={0}
                      x2={medianRevenue / 100}
                      y1={scatterBounds.minResult}
                      y2={0}
                      fill="var(--destructive)"
                      fillOpacity={0.06}
                      label={{ value: "Prioridade de decisão", position: "insideBottomLeft", fontSize: 10, fill: "var(--destructive)" }}
                    />

                    <ReferenceLine y={0} stroke="var(--border)" />
                    <ReferenceLine x={medianRevenue / 100} stroke="var(--border)" strokeDasharray="4 4" />
                    <ChartTooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null;
                        const p = payload[0].payload as (typeof scatterData)[number];
                        return (
                          <div className="rounded-md border bg-popover p-2 text-xs shadow-md">
                            <p className="font-medium">{p.name}</p>
                            <p>Vendas: {money(p.vendas * 100)}</p>
                            <p>Resultado: {money(p.resultado * 100)}</p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData}>
                      {scatterData.map((d) => (
                        <Cell key={d.store_id} fill={TONE_VAR[d.tone]} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Funcionários × Resultado */}
            {employeesChartData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Funcionários × Resultado</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Nº de funcionários do cliente em cada unidade (painel comercial) × resultado{" "}
                    {view === "pre" ? "da operação" : "após o rateio administrativo"} — pra achar a faixa que sustenta
                    um bom resultado. Só entram as lojas com esse dado cadastrado
                    {employeesChartData.length < rows.length ? ` (${employeesChartData.length} de ${rows.length})` : ""}.
                  </p>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={emptyConfig} className="h-96 w-full">
                    <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid stroke="var(--border)" />
                      <XAxis
                        type="number"
                        dataKey="funcionarios"
                        name="Funcionários"
                        domain={[0, employeesChartBounds.maxFuncionarios]}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "var(--muted-foreground)" }}
                        label={{ value: "Funcionários do cliente", position: "insideBottom", offset: -4, fontSize: 11, fill: "var(--muted-foreground)" }}
                      />
                      <YAxis
                        type="number"
                        dataKey="resultado"
                        name="Resultado"
                        domain={[employeesChartBounds.minResult, employeesChartBounds.maxResult]}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "var(--muted-foreground)" }}
                        tickFormatter={(value: number) => moneyCompact(value * 100)}
                      />
                      <ZAxis range={[90, 90]} />
                      <ReferenceLine y={0} stroke="var(--border)" />
                      <ChartTooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.[0]) return null;
                          const p = payload[0].payload as (typeof employeesChartData)[number];
                          return (
                            <div className="rounded-md border bg-popover p-2 text-xs shadow-md">
                              <p className="font-medium">{p.name}</p>
                              <p>Funcionários: {p.funcionarios}</p>
                              <p>Resultado: {money(p.resultado * 100)}</p>
                            </div>
                          );
                        }}
                      />
                      <Scatter data={employeesChartData}>
                        {employeesChartData.map((d) => (
                          <Cell key={d.store_id} fill={TONE_VAR[d.tone]} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {/* Perdas + Cobertura */}
            <div className={`grid grid-cols-1 gap-4 ${view === "post" ? "lg:grid-cols-2" : ""}`}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Perdas por loja</CardTitle>
                  <p className="text-xs text-muted-foreground">% de perdas sobre vendas — meta ≤ {LOSS_THRESHOLD_PCT}%.</p>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={emptyConfig} className="h-80 w-full">
                    <BarChart data={perdasChartData} margin={{ top: 24 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={60} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                      <ReferenceLine y={LOSS_THRESHOLD_PCT} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: `Meta ${LOSS_THRESHOLD_PCT}%`, position: "right", fill: "var(--warning)", fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />} />
                      <Bar dataKey="pct" radius={4}>
                        {perdasChartData.map((d) => (
                          <Cell key={d.store_id} fill={d.pct > LOSS_THRESHOLD_PCT ? "var(--destructive)" : "var(--success)"} />
                        ))}
                        <LabelList dataKey="pct" position="top" formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} fontSize={10} />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              {view === "post" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">Cobertura da estrutura</CardTitle>
                    <p className="text-xs text-muted-foreground">Margem de contribuição ÷ Rateio administrativo.</p>
                    <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: "var(--success)" }} /> ≥ {COVERAGE_HEALTHY.toFixed(1)}× Saudável</span>
                      <span className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: "var(--warning)" }} /> {COVERAGE_WATCH.toFixed(1)}–{COVERAGE_HEALTHY.toFixed(1)}× Atenção</span>
                      <span className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: "var(--destructive)" }} /> &lt; {COVERAGE_WATCH.toFixed(1)}× Não cobre</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={emptyConfig} className="h-80 w-full">
                      <BarChart data={coverageChartData} margin={{ top: 24 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={60} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => `${v.toFixed(1)}×`} />
                        <ReferenceLine y={1} stroke="var(--border)" />
                        <ChartTooltip content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(2)}×`} />} />
                        <Bar dataKey="coverage" radius={4}>
                          {coverageChartData.map((d) => (
                            <Cell
                              key={d.store_id}
                              fill={d.coverage >= COVERAGE_HEALTHY ? "var(--success)" : d.coverage >= COVERAGE_WATCH ? "var(--warning)" : "var(--destructive)"}
                            />
                          ))}
                          <LabelList dataKey="coverage" position="top" formatter={(v: unknown) => `${Number(v).toFixed(1)}×`} fontSize={10} />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Alertas automáticos */}
            <div>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                Atenção necessária{" "}
                <span className="font-normal">
                  — análise automática sobre {mode === "avg3" ? "a média dos últimos 3 meses" : fmtPeriod(basePeriod)}
                  {previousMonthQuery.data ? ", comparada ao mês anterior" : ""} ({view === "pre" ? "Sem rateio" : "Com rateio"})
                </span>
              </h2>
              {insights.length === 0 ? (
                <Card className="border-l-4 border-l-success">
                  <CardContent className="pt-6">
                    <p className="text-sm">Nenhum ponto crítico encontrado neste período — todas as lojas dentro do esperado.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {insights.map((insight) => (
                    <AlertCard key={insight.id} tone={SEVERITY_TONE[insight.severity]} title={insight.title}>
                      {insight.details.slice(0, 4).map((line, i) => (
                        <p key={i} className="text-sm">
                          {line}
                        </p>
                      ))}
                      {insight.details.length > 4 && (
                        <p className="text-xs text-muted-foreground">+ {insight.details.length - 4} loja(s)</p>
                      )}
                    </AlertCard>
                  ))}
                </div>
              )}
            </div>

            {/* Por cliente */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Resultado por cliente</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Soma das lojas de cada cliente — pra avaliar se vale a pena manter a relação inteira, não só uma
                  loja isolada.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="tabular text-right">Lojas</TableHead>
                      <TableHead className="tabular text-right">Vendas</TableHead>
                      <TableHead className="tabular text-right">Margem de contribuição</TableHead>
                      {view === "post" && <TableHead className="tabular text-right">Rateio</TableHead>}
                      <TableHead className="tabular text-right">Resultado{view === "post" ? " após rateio" : ""}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byClient.map(([client, g]) => (
                      <TableRow key={client}>
                        <TableCell className="font-medium">{client}</TableCell>
                        <TableCell className="tabular text-right">{g.storeCount}</TableCell>
                        <TableCell className="tabular text-right">{money(g.gross_revenue_cents)}</TableCell>
                        <TableCell className="tabular text-right">
                          {money(view === "pre" ? g.contribution_margin_excl_admin_cents : g.contribution_margin_cents)}
                        </TableCell>
                        {view === "post" && (
                          <TableCell className="tabular text-right text-destructive">({money(g.admin_allocated_cents)})</TableCell>
                        )}
                        <TableCell className={`tabular text-right ${clientResultOf(g, view) < 0 ? "text-destructive" : "text-success"}`}>
                          {money(clientResultOf(g, view))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Tabela detalhada */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Detalhamento por loja</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Use a busca, os filtros de status, os filtros por coluna (valores exatos, tipo planilha), e o botão
                  de ação pra abrir o DRE completo de uma loja.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-64">
                    <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Buscar loja..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <FilterPill label="Todas" count={rows.length} active={statusFilter === "todas"} onClick={() => setStatusFilter("todas")} />
                  <FilterPill label="Saudáveis" count={statusCounts.saudavel} tone="positive" active={statusFilter === "saudavel"} onClick={() => setStatusFilter("saudavel")} />
                  <FilterPill label="Atenção" count={statusCounts.atencao} tone="attention" active={statusFilter === "atencao"} onClick={() => setStatusFilter("atencao")} />
                  <FilterPill label="Críticas" count={statusCounts.critica} tone="critical" active={statusFilter === "critica"} onClick={() => setStatusFilter("critica")} />
                  {activeColumnFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setColumnFilters({})}>
                      <X /> Limpar filtros por coluna ({activeColumnFilterCount})
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {FILTER_COLUMNS.filter((col) => !col.postOnly || view === "post").map((col) => (
                    <ColumnValueFilter
                      key={col.key}
                      label={col.label}
                      options={columnOptions.get(col.key) ?? new Map()}
                      selected={columnFilters[col.key] ?? EMPTY_SELECTION}
                      onChange={(next) => setColumnFilters((prev) => ({ ...prev, [col.key]: next }))}
                    />
                  ))}
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Loja</TableHead>
                      <TableHead className="tabular text-right">Funcionários</TableHead>
                      <TableHead className="tabular text-right">Vendas</TableHead>
                      <TableHead className="tabular text-right">CMV</TableHead>
                      <TableHead className="tabular text-right">Perdas %</TableHead>
                      <TableHead className="tabular text-right">Mensalidade</TableHead>
                      <TableHead className="tabular text-right">Margem de contribuição</TableHead>
                      <TableHead className="tabular text-right">Margem %</TableHead>
                      {view === "post" && (
                        <TableHead className="tabular text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help underline decoration-dotted">Rateio</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64">
                              Só o pacote administrativo de rede (contador, pró-labore, sistema, ERP, juros,
                              marketing/degustações), estimado por divisão igual entre lojas ativas. Deslocamento e
                              Repasse já contam dentro da margem de contribuição, nas duas visões — são custo real
                              da loja.
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                      )}
                      {view === "post" && (
                        <TableHead className="tabular text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help underline decoration-dotted">Cobertura</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64">
                              Margem de contribuição ÷ Rateio administrativo. Acima de {COVERAGE_HEALTHY.toFixed(1)}× é
                              saudável, {COVERAGE_WATCH.toFixed(1)}–{COVERAGE_HEALTHY.toFixed(1)}× pede atenção, abaixo
                              de {COVERAGE_WATCH.toFixed(1)}× a loja não cobre sua fatia da estrutura.
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                      )}
                      <TableHead>Status</TableHead>
                      <TableHead className="tabular text-right">Resultado{view === "post" ? " após rateio" : " operacional"}</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={detailColSpan} className="text-center text-sm text-muted-foreground">
                          Nenhuma loja bate com a busca/filtro.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRows.map((row) => (
                        <StoreRow
                          key={row.store_id}
                          row={row}
                          store={storeById.get(row.store_id)}
                          status={statusByStore.get(row.store_id)!}
                          period={basePeriod}
                          view={view}
                          employees={employeesByStore.get(row.store_id) ?? null}
                        />
                      ))
                    )}
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="tabular text-right">
                        {employeesChartData.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          employeesChartData.reduce((sum, d) => sum + d.funcionarios, 0)
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">{money(totals.gross_revenue_cents)}</TableCell>
                      <TableCell className="tabular text-right">({money(totals.cogs_cents)})</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="tabular text-right">{money(totals.margin_cents)}</TableCell>
                      <TableCell className="tabular text-right">
                        {totals.gross_revenue_cents > 0 ? `${((totals.margin_cents / totals.gross_revenue_cents) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                      {view === "post" && (
                        <TableCell className="tabular text-right text-destructive">({money(totals.admin_allocated_cents)})</TableCell>
                      )}
                      {view === "post" && <TableCell />}
                      <TableCell />
                      <TableCell className={`tabular text-right ${totals.result_cents < 0 ? "text-destructive" : "text-success"}`}>
                        {money(totals.result_cents)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </RequestState>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  trendPct,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "positive" | "critical";
  trendPct?: number | null;
}) {
  const color = tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : "";
  const iconTone = tone ?? "neutral";
  const iconClass =
    iconTone === "positive" ? "bg-success/10 text-success" : iconTone === "critical" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary";

  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-6">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className={`tabular text-xl font-semibold ${color}`}>{value}</p>
          {trendPct !== undefined && trendPct !== null && (
            <p className={`text-xs ${trendPct >= 0 ? "text-success" : "text-destructive"}`}>
              {trendPct >= 0 ? "▲" : "▼"} {Math.abs(trendPct).toFixed(0)}% vs. mês anterior
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const SEVERITY_TONE: Record<InsightSeverity, "critical" | "warning" | "success"> = {
  critical: "critical",
  warning: "warning",
  positive: "success",
};

function AlertCard({ tone, title, children }: { tone: "critical" | "warning" | "success" | "neutral"; title: string; children: React.ReactNode }) {
  const border = { critical: "border-l-destructive", warning: "border-l-warning", success: "border-l-success", neutral: "border-l-primary" }[tone];
  const titleColor = { critical: "text-destructive", warning: "text-warning", success: "text-success", neutral: "text-primary" }[tone];
  return (
    <Card className={`border-l-4 ${border}`}>
      <CardHeader>
        <CardTitle className={`text-sm font-semibold ${titleColor}`}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">{children}</CardContent>
    </Card>
  );
}

function FilterPill({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone?: "positive" | "attention" | "critical";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {tone && <StatusBadge tone={tone}>{count}</StatusBadge>}
      {!tone && <span className="tabular">{count}</span>}
      {label}
    </button>
  );
}

/**
 * Filtro por valor exato de uma coluna, tipo AutoFilter de planilha —
 * pedido do operador 2026-09-18: "filtrar funcionários e ver todas as
 * lojas com 50 funcionários, ou todas as lojas da Ascenty". Marcar mais de
 * um valor é OR (ex.: 50 + 100 funcionários); marcar em colunas diferentes
 * é AND (funcionários = 50 E cliente = Ascenty).
 */
function StoreRow({
  row,
  store,
  status,
  period,
  view,
  employees,
}: {
  row: StorePnlSummary;
  store?: Store;
  status: Status;
  period: string;
  view: View;
  employees: number | null;
}) {
  const perdasPct = row.gross_revenue_cents > 0 ? (row.perdas_cents / row.gross_revenue_cents) * 100 : 0;
  const result = resultOf(row, view);
  const margin = marginOf(row, view);
  const marginPct = row.gross_revenue_cents > 0 ? (margin / row.gross_revenue_cents) * 100 : null;
  const negative = result < 0;
  const coverage = row.admin_allocated_cents > 0 ? row.contribution_margin_excl_admin_cents / row.admin_allocated_cents : null;

  return (
    <TableRow>
      <TableCell>
        <span className="text-sm">{store?.name ?? `Loja ${row.store_id}`}</span>
      </TableCell>
      <TableCell className="tabular text-right">
        {employees === null ? <span className="text-muted-foreground">—</span> : employees}
      </TableCell>
      <TableCell className="tabular text-right">{money(row.gross_revenue_cents)}</TableCell>
      <TableCell className="tabular text-right">({money(row.cogs_cents)})</TableCell>
      <TableCell className="tabular text-right">{perdasPct.toFixed(1)}%</TableCell>
      <TableCell className="tabular text-right">
        {row.mensalidade_cents === 0 ? <span className="text-muted-foreground">—</span> : money(row.mensalidade_cents)}
      </TableCell>
      <TableCell className="tabular text-right">{money(margin)}</TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {marginPct === null ? "—" : `${marginPct.toFixed(1)}%`}
      </TableCell>
      {view === "post" && <TableCell className="tabular text-right text-destructive">({money(row.admin_allocated_cents)})</TableCell>}
      {view === "post" && (
        <TableCell className="tabular text-right">
          {coverage === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={coverage >= COVERAGE_HEALTHY ? "text-success" : coverage >= COVERAGE_WATCH ? "text-warning" : "text-destructive"}>
              {coverage.toFixed(1)}×
            </span>
          )}
        </TableCell>
      )}
      <TableCell>
        <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
        {status === "positiva_nao_absorve" && <p className="mt-0.5 text-xs text-muted-foreground">Não absorve a estrutura</p>}
      </TableCell>
      <TableCell className="tabular text-right">
        <span className={negative ? "text-destructive" : "text-success"}>{money(result)}</span>
      </TableCell>
      <TableCell className="text-right">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/finance/pnl?store_id=${row.store_id}&period=${period}`}>Ver DRE</Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
