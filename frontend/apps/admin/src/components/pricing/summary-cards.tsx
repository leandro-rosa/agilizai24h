import { CircleAlert, TrendingUp, Wallet } from "lucide-react";

import { SummaryCard } from "@/components/summary-card";
import type { PricingSummary } from "@/lib/api/pricing";
import { count } from "@/lib/format";
import { percent, points, signedMoney } from "@/lib/pricing/labels";

/** O que a "margem atual" é, dito uma vez e igual na tabela, nos cartões e no detalhe. */
export const MARGIN_DEFINITION = "Margem econômica: o que sobra do preço depois do custo, das perdas, dos impostos, das taxas de pagamento e do rateio operacional.";

/** A premissa do impacto estimado: é uma estimativa, não uma promessa de que as vendas se mantêm. */
export const IMPACT_PREMISE = "Estimativa que supõe o mesmo volume de vendas de hoje. Um preço maior pode vender menos: não é lucro garantido.";

/**
 * Três cartões, sobre os produtos que TÊM dados para a análise (o escopo inteiro, não o filtrado). Quantos produtos a análise cobre vem dito logo abaixo:
 * produto sem dados suficientes nunca entra como margem zero. Um número que o backend não deu é "Indisponível", nunca zero.
 */
export function SummaryCards({ summary }: { summary: PricingSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {["Margem dos produtos analisáveis", "Produtos que precisam de revisão", "Impacto mensal estimado"].map((label) => (
          <SummaryCard key={label} label={label} value="Indisponível" tone="muted" />
        ))}
      </div>
    );
  }

  const gap = summary.averageMargin === null ? null : summary.averageMargin - summary.targetMargin;
  const coverage = summary.coverage ?? { total: summary.analysed, analysable: summary.analysed - summary.insufficientData, withoutEnoughData: summary.insufficientData };
  const toReview = summary.belowTarget + summary.review;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Margem dos produtos analisáveis"
          value={percent(summary.averageMargin)}
          icon={TrendingUp}
          tone={gap === null ? "muted" : gap >= 0 ? "positive" : "attention"}
          hint={`Meta: ${percent(summary.targetMargin, 0)}${gap === null ? "" : ` · ${points(gap)}`}`}
        />
        <SummaryCard
          label="Produtos que precisam de revisão"
          value={count(toReview)}
          icon={CircleAlert}
          tone={toReview > 0 ? "attention" : undefined}
          hint={`${count(summary.belowTarget)} abaixo da margem · ${count(summary.review)} para revisar`}
        />
        <SummaryCard label="Impacto mensal estimado" value={signedMoney(summary.potentialImpactCentsPerMonth)} icon={Wallet} hint="Estimativa, não lucro garantido" />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="coverage">
        A análise cobre <strong>{count(coverage.analysable)} de {count(coverage.total)}</strong> produtos
        {coverage.withoutEnoughData > 0 ? `; ${count(coverage.withoutEnoughData)} ficaram sem dados suficientes e não entram nas médias.` : "."} {MARGIN_DEFINITION} {IMPACT_PREMISE}
      </p>
    </div>
  );
}
