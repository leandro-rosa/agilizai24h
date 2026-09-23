"use client";

import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MixOpportunity, ProductCategory, RestockAction, RestockRecommendation, Trend } from "@/lib/commercial-intelligence/restock-mix/types";

export type RestockDisplayRow =
  | { kind: "recomendacao"; productLabel: string; storeName: string; data: RestockRecommendation }
  | { kind: "oportunidade"; productLabel: string; storeName: string; data: MixOpportunity };

export const ACTION_LABELS: Record<RestockAction, string> = {
  aumentar: "Aumentar",
  manter: "Manter",
  reduzir: "Reduzir",
  nao_abastecer: "Não abastecer",
  testar: "Testar",
  dados_insuficientes: "Dados insuficientes",
};

export const ACTION_TONE: Record<RestockAction, "neutral" | "positive" | "attention" | "critical"> = {
  aumentar: "positive",
  manter: "positive",
  reduzir: "attention",
  nao_abastecer: "critical",
  testar: "attention",
  dados_insuficientes: "neutral",
};

const CATEGORY_LABELS: Record<ProductCategory, string> = { meal: "Refeição", snack: "Snack", beverage: "Bebida", essential: "Essencial" };

const TREND_ICON: Record<Trend, string> = { crescendo: "↑", estavel: "→", caindo: "↓", volatil: "↻", indeterminada: "—" };
const TREND_LABEL: Record<Trend, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };

const LOSS_OVERRIDE_ACTIONS = new Set(["suspender_abastecimento", "avaliar_retirada_loja", "avaliar_retirada_rede", "reduzir_abastecimento", "investigar", "avaliar_permanencia_loja", "avaliar_permanencia_rede"]);

function signalLabel(row: RestockDisplayRow): string {
  if (row.kind === "oportunidade") return "💎 Oportunidade de mix";
  const rec = row.data;
  if (rec.sinalPerdas && LOSS_OVERRIDE_ACTIONS.has(rec.sinalPerdas.acao)) return "⚠ Sinal de perdas ativo";
  return `${TREND_ICON[rec.tendencia]} ${TREND_LABEL[rec.tendencia]}`;
}

function rowKey(row: RestockDisplayRow): string {
  return row.kind === "recomendacao" ? `${row.data.storeId}:${row.data.sku}` : `${row.data.storeId}:${row.data.sku}:oportunidade`;
}

function effectiveAction(row: RestockDisplayRow): RestockAction {
  return row.kind === "oportunidade" ? "testar" : row.data.acao;
}

function suggestedQuantity(row: RestockDisplayRow): number {
  return row.kind === "oportunidade" ? row.data.quantidadeTeste : row.data.quantidadeSugeridaIA;
}

type RestockView = "todos" | "levar" | "reduzir" | "nao_levar" | "testar";
const VIEW_LABELS: Record<RestockView, string> = { todos: "Todos", levar: "Levar", reduzir: "Reduzir", nao_levar: "Não levar", testar: "Testar" };
const VIEW_FILTERS: Record<RestockView, (action: RestockAction) => boolean> = {
  todos: () => true,
  levar: (a) => a === "aumentar" || a === "manter",
  reduzir: (a) => a === "reduzir",
  nao_levar: (a) => a === "nao_abastecer",
  testar: (a) => a === "testar",
};

export function RestockTable({ rows, onSelect }: { rows: RestockDisplayRow[]; onSelect: (row: RestockDisplayRow) => void }) {
  const [view, setView] = useState<RestockView>("todos");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [showGeneratedList, setShowGeneratedList] = useState(false);

  const filtered = useMemo(() => rows.filter((row) => VIEW_FILTERS[view](effectiveAction(row))), [rows, view]);

  function effectiveQuantity(row: RestockDisplayRow): number {
    return overrides[rowKey(row)] ?? suggestedQuantity(row);
  }

  const generated = useMemo(() => {
    const abastecer: RestockDisplayRow[] = [];
    const naoAbastecer: RestockDisplayRow[] = [];
    const testes: RestockDisplayRow[] = [];
    for (const row of rows) {
      const action = effectiveAction(row);
      if (action === "testar") testes.push(row);
      else if (action === "nao_abastecer" || effectiveQuantity(row) === 0) naoAbastecer.push(row);
      else abastecer.push(row);
    }
    return { abastecer, naoAbastecer, testes };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overrides é lido via effectiveQuantity, recalcular junto com ele é intencional
  }, [rows, overrides]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as RestockView)}>
          <TabsList>
            {(Object.entries(VIEW_LABELS) as [RestockView, string][]).map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => setShowGeneratedList(true)}>
          Gerar lista de abastecimento
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Vendas recentes</TableHead>
            <TableHead>Sinal</TableHead>
            <TableHead className="text-right">Último abastecimento</TableHead>
            <TableHead className="text-right">Sugestão IA</TableHead>
            <TableHead className="text-right">Quantidade final</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>Confiança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => {
            const key = rowKey(row);
            const isOpportunity = row.kind === "oportunidade";
            const categoria = isOpportunity ? null : row.data.categoria;
            const vendasRecentes = isOpportunity ? null : row.data.vendasUltimoMes;
            const ultimoAbastecimento = isOpportunity ? null : row.data.ultimoAbastecimento;
            const confianca = row.data.confianca;
            return (
              <TableRow key={key} className="cursor-pointer" onClick={() => onSelect(row)}>
                <TableCell className="font-medium">{row.productLabel}</TableCell>
                <TableCell>{categoria ? CATEGORY_LABELS[categoria] : "—"}</TableCell>
                <TableCell className="text-right tabular">{vendasRecentes ?? "—"}</TableCell>
                <TableCell>{signalLabel(row)}</TableCell>
                <TableCell className="text-right tabular">{ultimoAbastecimento ?? "—"}</TableCell>
                <TableCell className="text-right tabular">{suggestedQuantity(row)}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Input
                    type="number"
                    min={0}
                    className="w-20 text-right"
                    value={effectiveQuantity(row)}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: Math.max(0, Number(e.target.value) || 0) }))}
                    aria-label={`Quantidade final — ${row.productLabel}`}
                  />
                </TableCell>
                <TableCell>
                  <StatusBadge tone={ACTION_TONE[effectiveAction(row)]}>{ACTION_LABELS[effectiveAction(row)]}</StatusBadge>
                </TableCell>
                <TableCell className="capitalize">{confianca}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={showGeneratedList} onOpenChange={setShowGeneratedList}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lista de abastecimento gerada</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 text-sm">
            {([
              ["Abastecer", generated.abastecer],
              ["Não abastecer", generated.naoAbastecer],
              ["Testes", generated.testes],
            ] as const).map(([label, group]) => (
              <div key={label}>
                <p className="mb-1 font-medium">
                  {label} ({group.length})
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {group.map((row) => (
                    <li key={rowKey(row)}>
                      {row.productLabel} — {row.storeName}: {effectiveQuantity(row)} un.
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
