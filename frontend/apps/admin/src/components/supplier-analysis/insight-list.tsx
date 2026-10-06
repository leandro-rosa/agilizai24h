import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import type { Insight } from "@/lib/api/supplier-analysis";

const TONE: Record<Insight["tone"], StatusTone> = { positive: "positive", attention: "attention", critical: "critical", info: "neutral" };

function figureText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/**
 * Cada insight mostra a evidência que o originou — os números usados e a conta —
 * e o rótulo que diz o que ele é (FATO, MÉTRICA DERIVADA ou ESTIMATIVA).
 */
export function InsightList({ title, insights }: { title: string; insights: Insight[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {insights.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem insights para este período com os dados disponíveis.</p>
        )}
        {insights.map((insight, index) => (
          <div key={`${insight.kind}-${index}`} className="flex flex-col gap-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={TONE[insight.tone]}>{insight.label}</StatusBadge>
            </div>
            <p className="text-sm">{insight.text}</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Ver evidência</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {Object.entries(insight.evidence.figures).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt>{key}</dt>
                    <dd className="tabular text-foreground">{figureText(value)}</dd>
                  </div>
                ))}
              </dl>
              {insight.evidence.formula && <p className="mt-2">Conta: {insight.evidence.formula}</p>}
              {insight.evidence.reference && <p>Referência: {insight.evidence.reference}</p>}
            </details>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
