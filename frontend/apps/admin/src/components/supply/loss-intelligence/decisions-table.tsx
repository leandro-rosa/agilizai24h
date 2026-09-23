"use client";

import { useMemo, useState } from "react";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Level } from "@/lib/commercial-intelligence/types";
import type { Confidence, EscopoProblema, LossAction, LossIntelligenceRecommendation, LossReason, Priority, ReasonDiagnosis } from "@/lib/loss-intelligence/types";

export const ACTION_LABELS: Record<LossAction, string> = {
  manter: "Manter",
  manter_monitorar: "Manter e monitorar",
  reduzir_abastecimento: "Reduzir",
  investigar: "Investigar",
  suspender_abastecimento: "Suspender",
  avaliar_retirada_loja: "Avaliar retirada (loja)",
  avaliar_retirada_rede: "Avaliar retirada (rede)",
  avaliar_permanencia_loja: "Avaliar permanência (loja)",
  avaliar_permanencia_rede: "Avaliar permanência (rede)",
  dados_insuficientes: "Dados insuficientes",
};

export const ACTION_TONE: Record<LossAction, "neutral" | "positive" | "attention" | "critical"> = {
  manter: "positive",
  manter_monitorar: "positive",
  reduzir_abastecimento: "attention",
  investigar: "attention",
  suspender_abastecimento: "critical",
  avaliar_retirada_loja: "critical",
  avaliar_retirada_rede: "critical",
  avaliar_permanencia_loja: "critical",
  avaliar_permanencia_rede: "critical",
  dados_insuficientes: "neutral",
};

const REASON_LABELS: Record<LossReason, string> = { expired: "Validade", damaged_product: "Danificado", other_reason: "Outro motivo" };

/**
 * `ConfidenceBadge` (Task 18's sibling, `commercial-intelligence/confidence-badge.tsx`)
 * takes `level: Level` (`"high" | "medium" | "low" | "insufficient"`), a different
 * domain's English enum — not this engine's `Confidence` (`"alta" | "media" | "baixa" |
 * "insuficiente"`). Values, not just the prop name, diverge from what the brief assumed;
 * this table still reuses the badge (rather than inventing a second confidence badge) by
 * translating at the boundary.
 */
export const CONFIDENCE_TO_LEVEL: Record<Confidence, Level> = {
  alta: "high",
  media: "medium",
  baixa: "low",
  insuficiente: "insufficient",
};

/** Rótulo curto por código de sinal/regra, cobrindo tudo que as 3 árvores emitem (§10.1-10.4, adenda 2026-09-23 §23.3). Nenhuma regra nova, só a tradução pra leitura na tabela. */
export const SIGNAL_LABELS: Record<string, string> = {
  ZERO_SALES_REPEATED_SUPPLY_EXPIRY_LOSS: "Zero vendas com abastecimento repetido",
  LOW_SALE_RATIO_RECURRING_EXPIRY: "Vendas baixas recorrentes por validade",
  HEALTHY_SALE_RATIO_ISOLATED_EXPIRY: "Vendas saudáveis, perda isolada por validade",
  LOCAL_OUTLIER_VS_HEALTHY_NETWORK: "Loja discrepante numa rede saudável",
  NETWORK_WIDE_LOW_PERFORMANCE_EXPIRY: "Baixo desempenho por validade em toda a rede",
  CAPPED_RECENT_HISTORY: "Histórico recente — ação contida",
  DAMAGE_CONCENTRATED_LOCAL: "Dano concentrado nesta loja",
  DAMAGE_SYSTEMIC_NETWORK: "Dano distribuído na rede",
  INSUFFICIENT_STORES_FOR_DAMAGE_PATTERN: "Poucas lojas para avaliar padrão de dano",
  OTHER_REASON_NEGLIGIBLE: "Perda de Outro motivo irrelevante",
  OTHER_REASON_MARGIN_UNKNOWN: "Margem desconhecida em Outro motivo",
  OTHER_REASON_SEVERE_RECURRING: "Perda recorrente e severa em Outro motivo",
  OTHER_REASON_NETWORK_WIDE: "Padrão de Outro motivo distribuído na rede",
  OTHER_REASON_HEALTHY_ISOLATED: "Produto saudável, perda isolada em Outro motivo",
  OTHER_REASON_RECURRING_OR_CONCENTRATED: "Perda recorrente ou concentrada em Outro motivo",
  INSUFFICIENT_EVIDENCE: "Evidência insuficiente",
};

const ESCOPO_LABELS: Record<EscopoProblema, string> = {
  local: "Local",
  multiplas_lojas: "Múltiplas lojas",
  rede: "Rede",
  indeterminado: "Indeterminado",
};

/** Quatro visões da tabela, não mais um filtro de Ação livre (adenda 2026-09-23 §23.3). */
export type DecisionsView = "requer_decisao" | "monitoramento" | "dados_insuficientes" | "todos";

const VIEW_FILTERS: Record<DecisionsView, (action: LossAction) => boolean> = {
  requer_decisao: (action) => action !== "manter" && action !== "manter_monitorar" && action !== "dados_insuficientes",
  monitoramento: (action) => action === "manter" || action === "manter_monitorar",
  dados_insuficientes: (action) => action === "dados_insuficientes",
  todos: () => true,
};

const VIEW_LABELS: Record<DecisionsView, string> = {
  requer_decisao: "Requer decisão",
  monitoramento: "Monitoramento",
  dados_insuficientes: "Dados insuficientes",
  todos: "Todos",
};

export interface DecisionRowData {
  recommendation: LossIntelligenceRecommendation;
  productLabel: string;
  storeName: string;
  category: string | null;
  diagnosticoResumo: string;
}

function primaryDiagnosis(recommendation: LossIntelligenceRecommendation): ReasonDiagnosis | null {
  if (!recommendation.motivoDiagnosticoPrioritario) return null;
  return recommendation.diagnosticosPorMotivo.find((d) => d.reason === recommendation.motivoDiagnosticoPrioritario) ?? null;
}

function signalLabel(recommendation: LossIntelligenceRecommendation): string {
  const diagnosis = primaryDiagnosis(recommendation);
  if (!diagnosis || diagnosis.sinaisDetectados.length === 0) return "—";
  return diagnosis.sinaisDetectados.map((code) => SIGNAL_LABELS[code] ?? code).join(" + ");
}

function escopoLabel(recommendation: LossIntelligenceRecommendation): string {
  const diagnosis = primaryDiagnosis(recommendation);
  return diagnosis ? ESCOPO_LABELS[diagnosis.escopoProblema] : "—";
}

export function LossDecisionsTable({ rows, onSelect }: { rows: DecisionRowData[]; onSelect: (recommendation: LossIntelligenceRecommendation) => void }) {
  const [view, setView] = useState<DecisionsView>("requer_decisao");
  const [reasonFilter, setReasonFilter] = useState<LossReason | "all">("all");
  const [actionFilter, setActionFilter] = useState<LossAction | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<Confidence | "all">("all");
  const [storeFilter, setStoreFilter] = useState<string | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");

  const stores = useMemo(() => [...new Set(rows.map((row) => row.storeName))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((row) => row.category).filter((c): c is string => c !== null))].sort(), [rows]);
  const insufficientCount = useMemo(() => rows.filter((row) => row.recommendation.acaoPrioritaria === "dados_insuficientes").length, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const r = row.recommendation;
        if (!VIEW_FILTERS[view](r.acaoPrioritaria)) return false;
        if (reasonFilter !== "all" && r.motivoDiagnosticoPrioritario !== reasonFilter) return false;
        if (actionFilter !== "all" && r.acaoPrioritaria !== actionFilter) return false;
        if (priorityFilter !== "all" && r.prioridade !== priorityFilter) return false;
        if (confidenceFilter !== "all" && r.confianca !== confidenceFilter) return false;
        if (storeFilter !== "all" && row.storeName !== storeFilter) return false;
        if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
        return true;
      }),
    [rows, view, reasonFilter, actionFilter, priorityFilter, confidenceFilter, storeFilter, categoryFilter],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as DecisionsView)}>
          <TabsList>
            {(Object.entries(VIEW_LABELS) as [DecisionsView, string][]).map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {insufficientCount > 0 && view !== "dados_insuficientes" && (
          <button
            type="button"
            onClick={() => setView("dados_insuficientes")}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {insufficientCount} {insufficientCount === 1 ? "produto" : "produtos"} com dados insuficientes
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect label="Motivo" value={reasonFilter} onChange={setReasonFilter} options={[["expired", "Validade"], ["damaged_product", "Danificado"], ["other_reason", "Outro motivo"]]} />
        <FilterSelect label="Ação" value={actionFilter} onChange={setActionFilter} options={(Object.entries(ACTION_LABELS) as [LossAction, string][])} />
        <FilterSelect label="Prioridade" value={priorityFilter} onChange={setPriorityFilter} options={[["critica", "Crítica"], ["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"]]} />
        <FilterSelect label="Confiança" value={confidenceFilter} onChange={setConfidenceFilter} options={[["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"], ["insuficiente", "Insuficiente"]]} />
        <FilterSelect label="Loja" value={storeFilter} onChange={setStoreFilter} options={stores.map((s) => [s, s] as [string, string])} />
        <FilterSelect label="Categoria" value={categoryFilter} onChange={setCategoryFilter} options={categories.map((c) => [c, c] as [string, string])} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Loja</TableHead>
            <TableHead className="text-right">Vendas</TableHead>
            <TableHead className="text-right">Abastecido</TableHead>
            <TableHead className="text-right">Perda</TableHead>
            <TableHead>Maior impacto</TableHead>
            <TableHead>Ação prioritária</TableHead>
            <TableHead>Sinal detectado</TableHead>
            <TableHead>Escopo do problema</TableHead>
            <TableHead>Diagnóstico</TableHead>
            <TableHead>Prioridade</TableHead>
            <TableHead>Confiança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => {
            const r = row.recommendation;
            const divergent = r.maiorImpactoFinanceiroMotivo !== null && r.maiorImpactoFinanceiroMotivo !== r.motivoDiagnosticoPrioritario;
            return (
              <TableRow key={`${r.storeId}-${r.sku}`} className="cursor-pointer" onClick={() => onSelect(r)}>
                <TableCell>{row.productLabel}</TableCell>
                <TableCell>{row.storeName}</TableCell>
                <TableCell className="text-right tabular">{r.metricasObservadas.qtySold}</TableCell>
                <TableCell className="text-right tabular">{r.metricasObservadas.qtyRestocked}</TableCell>
                <TableCell className="text-right tabular">{r.motivoDiagnosticoPrioritario ? r.metricasObservadas.byReason[r.motivoDiagnosticoPrioritario].qtyLost : 0}</TableCell>
                <TableCell>
                  {r.maiorImpactoFinanceiroMotivo ? REASON_LABELS[r.maiorImpactoFinanceiroMotivo] : "—"}
                  {divergent && <span className="ml-1 text-xs text-muted-foreground">(diagnóstico prioritário é outro)</span>}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={ACTION_TONE[r.acaoPrioritaria]}>{ACTION_LABELS[r.acaoPrioritaria]}</StatusBadge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{signalLabel(r)}</TableCell>
                <TableCell>{escopoLabel(r)}</TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{row.diagnosticoResumo}</TableCell>
                <TableCell className="capitalize">{r.prioridade ?? "—"}</TableCell>
                <TableCell>
                  <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[r.confianca]} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function FilterSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T | "all"; onChange: (value: T | "all") => void; options: [T, string][] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T | "all")}>
      <SelectTrigger className="w-auto min-w-36" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}: todos</SelectItem>
        {options.map(([optValue, optLabel]) => (
          <SelectItem key={optValue} value={optValue}>
            {optLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
