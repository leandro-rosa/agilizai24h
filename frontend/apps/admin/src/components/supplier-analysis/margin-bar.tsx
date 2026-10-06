import { formatFigure } from "@/lib/supplier-analysis/format";
import type { Figure } from "@/lib/api/supplier-analysis";
import { cn } from "@/lib/utils";

/** Margem em % com uma barra; abaixo do corte de atenção a barra vira a cor de alerta. */
export function MarginBar({ margin, threshold }: { margin: Figure; threshold: number }) {
  if (!margin.available) return <span className="text-xs text-muted-foreground">{formatFigure(margin, "share")}</span>;

  const low = margin.value < threshold;

  return (
    <span className="inline-flex items-center justify-end gap-2" title={low ? `Abaixo de ${Math.round(threshold * 100)}%: atenção` : undefined}>
      <span className={cn("tabular", low && "font-medium text-warning")}>{formatFigure(margin, "share")}</span>
      <span className="h-1.5 w-14 rounded-full bg-secondary">
        <span
          className="block h-1.5 rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, Math.round(margin.value * 100)))}%`, background: low ? "var(--warning)" : "var(--chart-3)" }}
        />
      </span>
    </span>
  );
}
