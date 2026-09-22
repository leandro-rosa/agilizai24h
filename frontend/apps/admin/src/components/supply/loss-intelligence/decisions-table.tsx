"use client";

import { useMemo, useState } from "react";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Level } from "@/lib/commercial-intelligence/types";
import type { Confidence, LossAction, LossIntelligenceRecommendation, LossReason, Priority } from "@/lib/loss-intelligence/types";

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

export interface DecisionRowData {
  recommendation: LossIntelligenceRecommendation;
  productLabel: string;
  storeName: string;
  category: string | null;
  diagnosticoResumo: string;
}

export function LossDecisionsTable({ rows, onSelect }: { rows: DecisionRowData[]; onSelect: (recommendation: LossIntelligenceRecommendation) => void }) {
  const [reasonFilter, setReasonFilter] = useState<LossReason | "all">("all");
  const [actionFilter, setActionFilter] = useState<LossAction | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<Confidence | "all">("all");
  const [storeFilter, setStoreFilter] = useState<string | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");

  const stores = useMemo(() => [...new Set(rows.map((row) => row.storeName))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((row) => row.category).filter((c): c is string => c !== null))].sort(), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const r = row.recommendation;
        if (reasonFilter !== "all" && r.motivoDiagnosticoPrioritario !== reasonFilter) return false;
        if (actionFilter !== "all" && r.acaoPrioritaria !== actionFilter) return false;
        if (priorityFilter !== "all" && r.prioridade !== priorityFilter) return false;
        if (confidenceFilter !== "all" && r.confianca !== confidenceFilter) return false;
        if (storeFilter !== "all" && row.storeName !== storeFilter) return false;
        if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
        return true;
      }),
    [rows, reasonFilter, actionFilter, priorityFilter, confidenceFilter, storeFilter, categoryFilter],
  );

  return (
    <div className="flex flex-col gap-3">
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
