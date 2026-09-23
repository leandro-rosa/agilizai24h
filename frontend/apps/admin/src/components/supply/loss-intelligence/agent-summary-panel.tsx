"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LossAction, LossIntelligenceRecommendation, LossIntelligenceResult, Priority } from "@/lib/loss-intelligence/types";

const ACTION_ICON: Record<LossAction, string> = {
  manter: "🟢",
  manter_monitorar: "🟢",
  reduzir_abastecimento: "🟡",
  investigar: "🟠",
  suspender_abastecimento: "🔴",
  avaliar_retirada_loja: "🔴",
  avaliar_retirada_rede: "⚫",
  avaliar_permanencia_loja: "🔴",
  avaliar_permanencia_rede: "⚫",
  dados_insuficientes: "—",
};

const ACTION_LABEL: Record<LossAction, string> = {
  manter: "manter",
  manter_monitorar: "manter e monitorar",
  reduzir_abastecimento: "reduzir abastecimento",
  investigar: "investigar",
  suspender_abastecimento: "suspender abastecimento",
  avaliar_retirada_loja: "avaliar retirada da loja",
  avaliar_retirada_rede: "avaliar retirada da rede",
  avaliar_permanencia_loja: "avaliar permanência na loja (Outro motivo)",
  avaliar_permanencia_rede: "avaliar permanência na rede (Outro motivo)",
  dados_insuficientes: "dados insuficientes",
};

/** manter/dados_insuficientes ficam fora — "requer decisão" no sentido de sair do piloto automático (adenda 2026-09-23 §23.2). */
const ACTIONABLE_ACTIONS = new Set<LossAction>([
  "reduzir_abastecimento",
  "investigar",
  "suspender_abastecimento",
  "avaliar_retirada_loja",
  "avaliar_retirada_rede",
  "avaliar_permanencia_loja",
  "avaliar_permanencia_rede",
]);

/** Da mais urgente pra menos — "baixa" (== manter) nunca aparece aqui, não é acionável. */
const PRIORITY_ORDER: Exclude<Priority, "baixa">[] = ["critica", "alta", "media"];
const PRIORITY_LABEL: Record<Exclude<Priority, "baixa">, string> = { critica: "Crítica", alta: "Alta", media: "Média" };

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Rede × Loja — adenda 2026-09-23 (§15.1.1): o painel responde a pergunta certa para o escopo selecionado, mesmo filtro já usado no resto da aba. */
export type AgentSummaryScope = { kind: "network" } | { kind: "store"; storeName: string };

function actionableRecommendations(result: LossIntelligenceResult): LossIntelligenceRecommendation[] {
  return result.recommendations.filter((r) => ACTIONABLE_ACTIONS.has(r.acaoPrioritaria));
}

/**
 * Bloco de prioridades no topo da seção inteligente da aba Perdas — nunca duplica os KPIs/gráficos
 * já existentes (spec §15.1, §25 do pedido). Adenda 2026-09-23 §23.2: agrupa por PRIORIDADE
 * primeiro (o que precisa de atenção primeiro), ação como detalhe secundário dentro de cada
 * prioridade — era o inverso antes. "Impacto potencial estimado" saiu daqui (cenário não
 * calibrado, §23.2) — só o valor já observado fica visível.
 */
export function AgentSummaryPanel({ result, scope, onSeeAll }: { result: LossIntelligenceResult; scope: AgentSummaryScope; onSeeAll: () => void }) {
  const actionable = actionableRecommendations(result);

  if (actionable.length === 0) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>✦ Inteligência de Perdas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Nenhum caso requer decisão neste período.</CardContent>
      </Card>
    );
  }

  const tiers = PRIORITY_ORDER.map((priority) => {
    const rows = actionable.filter((r) => r.prioridade === priority);
    const byAction = new Map<LossAction, number>();
    for (const r of rows) byAction.set(r.acaoPrioritaria, (byAction.get(r.acaoPrioritaria) ?? 0) + 1);
    return { priority, count: rows.length, byAction };
  }).filter((tier) => tier.count > 0);

  // §15.1.1 — a contagem de lojas afetadas só faz sentido em escopo Rede (numa loja só, é sempre 1).
  const affectedStoreCount = scope.kind === "network" ? new Set(actionable.map((r) => r.storeId)).size : null;
  const subtitle =
    scope.kind === "network"
      ? `${actionable.length} casos requerem decisão na operação · ${affectedStoreCount} loja${affectedStoreCount === 1 ? "" : "s"} afetada${affectedStoreCount === 1 ? "" : "s"}`
      : `${actionable.length} casos requerem decisão nesta loja`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>✦ Inteligência de Perdas</CardTitle>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {tiers.map((tier) => (
            <div key={tier.priority} className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {PRIORITY_LABEL[tier.priority]} — {tier.count} {tier.count === 1 ? "caso" : "casos"}
              </p>
              <ul className="flex flex-col gap-0.5 pl-3 text-sm text-muted-foreground">
                {[...tier.byAction.entries()].map(([action, count]) => (
                  <li key={action}>
                    {ACTION_ICON[action]} {count} {ACTION_LABEL[action]}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-sm">{formatCents(result.valueLostInPrioritizedCasesCents)} em perdas associadas aos casos priorizados.</p>
        <Button variant="outline" size="sm" onClick={onSeeAll} className="self-start">
          Ver todos os casos
        </Button>
      </CardContent>
    </Card>
  );
}
