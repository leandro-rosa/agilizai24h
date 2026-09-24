"use client";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Level } from "@/lib/commercial-intelligence/types";
import type { Confidence } from "@/lib/loss-intelligence/types";
import type { MixClassification, MixOpportunity, MixRecommendation, ProductCategory, Trend } from "@/lib/commercial-intelligence/restock-mix/types";

const CONFIDENCE_TO_LEVEL: Record<Confidence, Level> = { alta: "high", media: "medium", baixa: "low", insuficiente: "insufficient" };

export type MixDisplayRow = { productLabel: string; storeName: string; data: MixRecommendation };
export type MixOpportunityRow = { productLabel: string; storeName: string; data: MixOpportunity };

const CLASSIFICATION_LABELS: Record<MixClassification, string> = {
  manter: "manter",
  explorar: "explorar",
  reduzir: "reduzir",
  suspender_abastecimento: "suspender abastecimento",
  avaliar_retirada: "avaliar retirada",
  dados_insuficientes: "dados insuficientes",
};

const CLASSIFICATION_TONE: Record<MixClassification, "neutral" | "positive" | "attention" | "critical"> = {
  manter: "positive",
  explorar: "positive",
  reduzir: "attention",
  suspender_abastecimento: "critical",
  avaliar_retirada: "critical",
  dados_insuficientes: "neutral",
};

const CATEGORY_LABELS: Record<ProductCategory, string> = { meal: "Refeição", snack: "Snack", beverage: "Bebida", essential: "Essencial" };
const TREND_LABEL: Record<Trend, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function MixTable({
  rows,
  opportunities,
  onSelect,
  onSelectOpportunity,
}: {
  rows: MixDisplayRow[];
  opportunities: MixOpportunityRow[];
  onSelect: (row: MixDisplayRow) => void;
  onSelectOpportunity: (row: MixOpportunityRow) => void;
}) {
  const manter = rows.filter((r) => r.data.classificacao === "manter").length;
  const explorar = rows.filter((r) => r.data.classificacao === "explorar").length;
  const reduzir = rows.filter((r) => r.data.classificacao === "reduzir").length;
  const avaliarRetirada = rows.filter((r) => r.data.classificacao === "avaliar_retirada" || r.data.classificacao === "suspender_abastecimento").length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat value={manter} label="manter" />
          <Stat value={explorar} label="explorar" />
          <Stat value={reduzir} label="reduzir" />
          <Stat value={avaliarRetirada} label="avaliar retirada" />
          <Stat value={opportunities.length} label="oportunidades de teste" />
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Evidência</TableHead>
            <TableHead>Recomendação</TableHead>
            <TableHead>Confiança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.data.storeId}:${row.data.sku}`} className="cursor-pointer" onClick={() => onSelect(row)}>
              <TableCell className="font-medium">{row.productLabel}</TableCell>
              <TableCell>{CATEGORY_LABELS[row.data.categoria]}</TableCell>
              <TableCell>{TREND_LABEL[row.data.tendencia]}</TableCell>
              <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{row.data.evidencia}</TableCell>
              <TableCell>
                <StatusBadge tone={CLASSIFICATION_TONE[row.data.classificacao]}>{CLASSIFICATION_LABELS[row.data.classificacao]}</StatusBadge>
              </TableCell>
              <TableCell>
                <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[row.data.confianca]} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {opportunities.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">Oportunidades de novo mix</h3>
          <p className="mb-2 text-xs text-muted-foreground">Candidatos vêm do desempenho na rede inteira — ainda não comparamos com lojas parecidas.</p>
          <div className="flex flex-col gap-2">
            {opportunities.map((row) => (
              <button
                key={`${row.data.storeId}:${row.data.sku}`}
                type="button"
                onClick={() => onSelectOpportunity(row)}
                className="rounded-lg border p-3 text-left text-sm hover:bg-muted"
              >
                <p className="font-medium">{row.productLabel}</p>
                <p className="text-muted-foreground">Não vendido atualmente em {row.storeName}.</p>
                <p className="text-muted-foreground">{row.data.evidencia}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1">
                  Teste recomendado: {row.data.quantidadeTeste} unidades — Confiança: <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[row.data.confianca]} />
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
