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

/** Bloco de prioridades no topo da seção inteligente da aba Perdas — nunca duplica os KPIs/gráficos já existentes (spec §15.1, §25 do pedido). */
export function AgentSummaryPanel({ result, onSeeAll }: { result: LossIntelligenceResult; onSeeAll: () => void }) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>✦ Agente de Perdas</CardTitle>
        <p className="text-sm text-muted-foreground">{totalActionable} decisões recomendadas</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map((row) => (
            <li key={row.action}>
              {row.icon} {result.countsByAction[row.action]} {row.label}
            </li>
          ))}
        </ul>
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
