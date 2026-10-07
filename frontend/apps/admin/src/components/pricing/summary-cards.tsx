import { BadgeCheck, CircleAlert, Lightbulb, PackageX, TrendingUp, Wallet } from "lucide-react";

import { SummaryCard } from "@/components/summary-card";
import type { PricingSummary } from "@/lib/api/pricing";
import { count } from "@/lib/format";
import { percent, points, signedMoney } from "@/lib/pricing/labels";

/**
 * Os seis cartões descrevem o catálogo analisado do escopo inteiro (não o filtrado). Um número que o backend não
 * deu é "Indisponível", nunca zero; o impacto é sempre "Impacto potencial estimado", nunca lucro garantido.
 */
export function SummaryCards({ summary }: { summary: PricingSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {["Margem média do mix", "Produtos dentro da meta", "Produtos abaixo da margem", "Produtos com oportunidade", "Produtos sem custo confiável", "Impacto potencial"].map((label) => (
          <SummaryCard key={label} label={label} value="Indisponível" tone="muted" />
        ))}
      </div>
    );
  }

  const share = (fraction: number) => `${percent(fraction, 0)} do catálogo analisado`;
  const gap = summary.averageMargin === null ? null : summary.averageMargin - summary.targetMargin;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <SummaryCard
        label="Margem média do mix"
        value={percent(summary.averageMargin)}
        icon={TrendingUp}
        tone={gap === null ? "muted" : gap >= 0 ? "positive" : "attention"}
        hint={`Meta: ${percent(summary.targetMargin, 0)}${gap === null ? "" : ` · ${points(gap)}`}`}
      />
      <SummaryCard label="Produtos dentro da meta" value={count(summary.withinTarget)} icon={BadgeCheck} tone="positive" hint={share(summary.shares.withinTarget)} />
      <SummaryCard label="Produtos abaixo da margem" value={count(summary.belowTarget)} icon={CircleAlert} tone={summary.belowTarget > 0 ? "attention" : undefined} hint={share(summary.shares.belowTarget)} />
      <SummaryCard label="Produtos com oportunidade" value={count(summary.opportunities)} icon={Lightbulb} hint={share(summary.shares.opportunities)} />
      <SummaryCard label="Produtos sem custo confiável" value={count(summary.insufficientData)} icon={PackageX} tone={summary.insufficientData > 0 ? "attention" : undefined} hint="Não recebem recomendação automática" />
      <SummaryCard label="Impacto potencial (mês)" value={signedMoney(summary.potentialImpactCentsPerMonth)} icon={Wallet} hint="Impacto potencial estimado — não é lucro garantido" />
    </div>
  );
}
