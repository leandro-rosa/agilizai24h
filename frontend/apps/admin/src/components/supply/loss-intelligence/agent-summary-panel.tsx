"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LossAction, LossIntelligenceResult } from "@/lib/loss-intelligence/types";

const ACTION_ROWS: { action: LossAction; icon: string; label: string }[] = [
  { action: "suspender_abastecimento", icon: "🔴", label: "suspender abastecimento" },
  { action: "reduzir_abastecimento", icon: "🟡", label: "reduzir abastecimento" },
  { action: "investigar", icon: "🟠", label: "investigar" },
  { action: "avaliar_retirada_rede", icon: "⚫", label: "avaliar retirada da rede" },
  { action: "avaliar_retirada_loja", icon: "🔴", label: "avaliar retirada da loja" },
  { action: "avaliar_permanencia_rede", icon: "⚫", label: "avaliar permanência na rede (Outro motivo)" },
  { action: "avaliar_permanencia_loja", icon: "🔴", label: "avaliar permanência na loja (Outro motivo)" },
];

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const ACTIONABLE_ACTIONS = new Set<LossAction>(ACTION_ROWS.map((row) => row.action));

/** Rede × Loja — adenda 2026-09-23 (§15.1.1): o painel responde a pergunta certa para o escopo selecionado, mesmo filtro já usado no resto da aba. */
export type AgentSummaryScope = { kind: "network" } | { kind: "store"; storeName: string };

/** Bloco de prioridades no topo da seção inteligente da aba Perdas — nunca duplica os KPIs/gráficos já existentes (spec §15.1, §25 do pedido). */
export function AgentSummaryPanel({ result, scope, onSeeAll }: { result: LossIntelligenceResult; scope: AgentSummaryScope; onSeeAll: () => void }) {
  const rows = ACTION_ROWS.filter((row) => (result.countsByAction[row.action] ?? 0) > 0);
  const totalActionable = rows.reduce((sum, row) => sum + (result.countsByAction[row.action] ?? 0), 0);

  if (totalActionable === 0) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>✦ Agente de Perdas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Nenhuma recomendação de atenção neste período.</CardContent>
      </Card>
    );
  }

  // §15.1.1 — a contagem de lojas afetadas só faz sentido em escopo Rede (numa loja só, é sempre 1).
  const affectedStoreCount =
    scope.kind === "network" ? new Set(result.recommendations.filter((r) => ACTIONABLE_ACTIONS.has(r.acaoPrioritaria)).map((r) => r.storeId)).size : null;
  const subtitle =
    scope.kind === "network"
      ? `${totalActionable} decisões recomendadas na operação · ${affectedStoreCount} loja${affectedStoreCount === 1 ? "" : "s"} afetada${affectedStoreCount === 1 ? "" : "s"}`
      : `${totalActionable} decisões recomendadas nesta loja`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>✦ Agente de Perdas</CardTitle>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map((row) => (
            <li key={row.action}>
              {row.icon} {result.countsByAction[row.action]} {row.label}
            </li>
          ))}
        </ul>
        <p className="text-sm">{formatCents(result.valueLostInPrioritizedCasesCents)} em perdas nos casos priorizados.</p>
        <p className="text-sm text-muted-foreground">
          Impacto potencial estimado: {formatCents(result.impactEstimateCents.conservative)}–{formatCents(result.impactEstimateCents.optimistic)}/mês em perdas potencialmente evitáveis.
        </p>
        <Button variant="outline" size="sm" onClick={onSeeAll} className="self-start">
          Ver todas as recomendações
        </Button>
      </CardContent>
    </Card>
  );
}
