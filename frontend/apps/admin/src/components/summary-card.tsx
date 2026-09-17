import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * `trend` é sempre calculado de um segundo `getTransactionSummaryQuery` do
 * mês anterior de verdade — nunca uma variação inventada. `trendPercent`
 * volta `null` sem base de comparação (mês anterior zerado), e aqui isso
 * vira "sem comparação" em vez de uma seta/porcentagem sem sentido — mesmo
 * princípio de "vazio honesto" do resto do painel (ver DESIGN.md), só que
 * na célula do card. Compartilhado entre Lançamentos e Fluxo de caixa —
 * não duplicar.
 */
export function SummaryCard({
  label,
  value,
  tone,
  hint,
  onClick,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  tone?: "positive" | "critical" | "attention" | "muted";
  hint?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  trend?: number | null;
}) {
  const color =
    tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : tone === "attention" ? "text-warning" : "";
  const badgeBg =
    tone === "positive"
      ? "bg-success/12 text-success"
      : tone === "critical"
        ? "bg-destructive/12 text-destructive"
        : tone === "attention"
          ? "bg-warning/12 text-warning"
          : "bg-muted text-muted-foreground";
  return (
    <Card
      className={`${tone === "muted" ? "border-dashed" : ""} ${onClick ? "cursor-pointer transition-colors hover:bg-accent/50" : ""}`}
      {...(onClick ? { role: "button", tabIndex: 0, onClick, onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && onClick() } : {})}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          {Icon && (
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${badgeBg}`}>
              <Icon className="size-4" />
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-2xl font-semibold ${tone === "muted" ? "text-muted-foreground" : color}`}>{value}</p>
        {trend !== undefined &&
          (trend === null ? (
            <p className="mt-1 text-xs text-muted-foreground">Sem comparação com o mês anterior</p>
          ) : (
            <p className={`mt-1 flex items-center gap-1 text-xs ${trend >= 0 ? "text-success" : "text-destructive"}`}>
              {trend >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {Math.abs(trend).toFixed(0)}% vs. mês anterior
            </p>
          ))}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
