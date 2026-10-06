/** Tendência mínima em SVG puro (sem eixos): mês não importado (null) quebra a linha em vez de cair a zero. */
export function Sparkline({ values, tone }: { values: (number | null)[]; tone: "up" | "down" | "flat" }) {
  const w = 72;
  const h = 22;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 2) + 1;
  const y = (v: number) => h - 2 - ((v - min) / span) * (h - 4);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  const color = tone === "up" ? "var(--success)" : tone === "down" ? "var(--destructive)" : "var(--muted-foreground)";
  return (
    <svg width={w} height={h} role="img" aria-label="Tendência das últimas vendas mensais" className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
