"use client";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { StatusBadge } from "@/components/status-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { explainRecommendation } from "@/lib/loss-intelligence/explain";
import type { LossIntelligenceRecommendation, LossReason } from "@/lib/loss-intelligence/types";
import { ACTION_LABELS, ACTION_TONE, CONFIDENCE_TO_LEVEL } from "./decisions-table";
import { RulesFiredDetail } from "./rules-fired-detail";

const REASON_LABELS: Record<LossReason, string> = { expired: "Validade", damaged_product: "Danificado", other_reason: "Outro motivo" };

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function LossDecisionDrawer({
  recommendation,
  productLabel,
  storeName,
  open,
  onOpenChange,
}: {
  recommendation: LossIntelligenceRecommendation | null;
  productLabel: string;
  storeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!recommendation) return null;
  const r = recommendation;

  // Only the diagnóstico prioritário's own comparacaoRede entry is ever read here — never
  // iterated across motivosSecundarios/LOSS_REASONS. For damaged_product this entry is always
  // "dado_insuficiente" (engine.ts never fabricates a network comparison for it, per Task 17's
  // review fix #3), and a secondary reason can genuinely be damaged_product — so reading any
  // entry beyond the prioritário's would risk surfacing that fabricated-data case again.
  const networkComparison = r.motivoDiagnosticoPrioritario ? r.comparacaoRede[r.motivoDiagnosticoPrioritario] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {productLabel} — {storeName}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={ACTION_TONE[r.acaoPrioritaria]}>{ACTION_LABELS[r.acaoPrioritaria]}</StatusBadge>
            <span className="text-sm text-muted-foreground capitalize">Prioridade: {r.prioridade ?? "—"}</span>
            <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[r.confianca]} />
          </div>

          <section>
            <h3 className="mb-1 text-sm font-medium">Evidências ({r.janelaAnalisada.primaryMonths.length} meses)</h3>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted-foreground">Abastecido</dt>
              <dd className="tabular">{r.metricasObservadas.qtyRestocked}</dd>
              <dt className="text-muted-foreground">Vendido</dt>
              <dd className="tabular">{r.metricasObservadas.qtySold}</dd>
              <dt className="text-muted-foreground">Meses com abastecimento</dt>
              <dd className="tabular">{r.metricasObservadas.monthsWithRestock}</dd>
              <dt className="text-muted-foreground">Margem gerada</dt>
              <dd className="tabular">{r.metricasObservadas.grossMarginCents !== null ? formatCents(r.metricasObservadas.grossMarginCents) : "desconhecida"}</dd>
            </dl>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Histórico</h3>
            <ul className="text-sm">
              {r.historico.map((entry) => (
                <li key={entry.period}>
                  {entry.period}: abastecido {entry.qtyRestocked} / vendido {entry.qtySold} / perdido {Object.values(entry.qtyLostByReason).reduce((sum, q) => sum + q, 0)}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Comparação com a rede</h3>
            {networkComparison && networkComparison !== "dado_insuficiente" ? (
              <p className="text-sm text-muted-foreground">O SKU tem desempenho saudável em {networkComparison.storesHealthy.length} outras lojas.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Lojas comparáveis insuficientes para uma comparação de rede.</p>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Diagnóstico</h3>
            <p className="text-sm">
              Maior impacto financeiro: {r.maiorImpactoFinanceiroMotivo ? REASON_LABELS[r.maiorImpactoFinanceiroMotivo] : "—"} ({formatCents(r.maiorImpactoFinanceiroValueCents)})
            </p>
            <p className="text-sm">Diagnóstico prioritário: {r.motivoDiagnosticoPrioritario ? REASON_LABELS[r.motivoDiagnosticoPrioritario] : "—"}</p>
            {r.motivosSecundarios.length > 0 && <p className="text-sm text-muted-foreground">Também presente: {r.motivosSecundarios.map((m) => REASON_LABELS[m]).join(", ")}.</p>}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-medium">Recomendação</h3>
            <p className="text-sm">{explainRecommendation(r)}</p>
          </section>

          <RulesFiredDetail diagnoses={r.diagnosticosPorMotivo} />

          {r.limitacoesDosDados.length > 0 && (
            <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
              <p className="font-medium">Limitações</p>
              <ul className="list-disc pl-4 text-xs">
                {r.limitacoesDosDados.map((limitacao) => (
                  <li key={limitacao}>{limitacao}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
