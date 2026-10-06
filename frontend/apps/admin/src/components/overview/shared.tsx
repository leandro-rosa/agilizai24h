import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signedPct, signedPp } from "@/lib/overview/compare";

export const moneyRound = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);

export const pctText = (v: number | null, digits = 1) => (v === null ? "—" : `${(v * 100).toFixed(digits).replace(".", ",")}%`);

export function Unavailable({ what }: { what?: string }) {
  return (
    <p className="flex items-center gap-1 text-sm text-warning">
      <AlertTriangle className="size-4 shrink-0" /> Indisponível{what ? ` — ${what}` : ""}
    </p>
  );
}

/** Seta + variação com cor por BOM/RUIM (perdas subindo é ruim), nunca por sinal. */
export function Delta({ value, kind, goodWhenUp, label }: { value: number | null; kind: "pct" | "pp"; goodWhenUp: boolean; label: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">{label}: sem comparação</span>;
  const up = value > 0;
  const flat = value === 0;
  const good = flat ? null : up === goodWhenUp;
  const color = good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const text = kind === "pct" ? signedPct(value) : signedPp(value);
  return (
    <span className={`tabular text-xs font-medium ${color}`}>
      {flat ? "→" : up ? "↑" : "↓"} {text.replace(/^[+−]/, "")} <span className="font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

export function Block({
  title,
  icon,
  href,
  linkLabel = "Ver análise completa",
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
          {href && (
            <Link href={href} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              {linkLabel} <ArrowRight className="size-3" />
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: React.ReactNode; tone?: "critical" | "positive" }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular text-lg font-semibold ${tone === "critical" ? "text-destructive" : tone === "positive" ? "text-success" : ""}`}>{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
