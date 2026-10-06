import { Tag } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { count } from "@/lib/format";
import { signedPct } from "@/lib/overview/compare";
import { priceImpactReading, type PriceChanges } from "@/lib/overview/price-volume";
import { Block, moneyRound, pctText, Stat } from "./shared";

const price = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
const signedMoney = (cents: number) => `${cents < 0 ? "−" : "+"}${moneyRound(Math.abs(cents))}`;

/**
 * Reajustes de preço do mês, produto a produto. Preço = preço REALIZADO (receita ÷ unidades), não o cadastro:
 * o catálogo só tem preço datado de parte dos produtos. É observação — não afirma que o preço causou a variação das unidades.
 */
export function PriceChangesCard({ changes }: { changes: PriceChanges | null }) {
  if (!changes) return null;
  const impact = changes.impact;
  const reading = priceImpactReading(changes, moneyRound);
  return (
    <Block title="Reajustes de preço no mês" icon={<Tag className="size-4 text-primary" />} href="/products" linkLabel="Ver produtos">
      <div
        className={`rounded-lg border p-4 ${reading.verdict.margin === "sim" ? "border-success/50 bg-success/10" : reading.verdict.margin === "nao" ? "border-destructive/50 bg-destructive/10" : "border-border bg-muted/30"}`}
      >
        <p className="text-xs font-semibold text-muted-foreground">Vendeu menos — o lucro compensou?</p>
        <p className={`text-lg font-semibold ${reading.verdict.margin === "sim" ? "text-success" : reading.verdict.margin === "nao" ? "text-destructive" : ""}`}>{reading.verdict.title}</p>
        <p className="text-sm leading-relaxed">{reading.verdict.detail}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Dinheiro que entrou (faturamento)"
          value={moneyRound(impact.revenueAfterCents)}
          hint={`${moneyRound(impact.revenueBeforeCents)} → ${moneyRound(impact.revenueAfterCents)} (${signedMoney(impact.revenueAfterCents - impact.revenueBeforeCents)})`}
          tone={impact.revenueAfterCents < impact.revenueBeforeCents ? "critical" : "positive"}
        />
        <Stat
          label="Lucro bruto (sobra após o custo)"
          value={impact.margin ? moneyRound(impact.margin.afterCents) : "—"}
          hint={impact.margin ? `${moneyRound(impact.margin.beforeCents)} → ${moneyRound(impact.margin.afterCents)} (${signedMoney(impact.margin.afterCents - impact.margin.beforeCents)})` : "sem custo resolvido"}
          tone={impact.margin ? (impact.margin.afterCents < impact.margin.beforeCents ? "critical" : "positive") : undefined}
        />
        <Stat label="Lucro de cada R$ 100 vendidos" value={impact.margin && impact.margin.pctAfter !== null ? `R$ ${Math.round(impact.margin.pctAfter * 100)}` : "—"} hint={impact.margin && impact.margin.pctBefore !== null ? `antes: R$ ${Math.round(impact.margin.pctBefore * 100)}` : undefined} />
        <Stat
          label="Unidades vendidas"
          value={count(changes.unitsAfter)}
          hint={`${count(changes.unitsBefore)} → ${count(changes.unitsAfter)} (${signedPct(changes.unitsBefore > 0 ? (changes.unitsAfter - changes.unitsBefore) / changes.unitsBefore : null, 0)})`}
          tone={changes.unitsAfter < changes.unitsBefore ? "critical" : "positive"}
        />
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {reading.lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead className="text-right" title="Lucro bruto ÷ preço: quanto de cada R$ vendido sobra depois do custo">Lucro bruto (% do preço)</TableHead>
              <TableHead className="text-right" title="Faturamento do produto no mês menos o do mês anterior">Faturamento (mudança)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.rows.map((r) => (
              <TableRow key={r.sku}>
                <TableCell className="max-w-56 truncate font-medium" title={r.name}>{r.name}</TableCell>
                <TableCell className="tabular text-right">
                  {price(r.priceBeforeCents)} → {price(r.priceAfterCents)}
                  <p className="text-[11px] text-muted-foreground">{signedPct(r.pricePct, 0)}</p>
                </TableCell>
                <TableCell className="tabular text-right">
                  {count(r.unitsBefore)} → {count(r.unitsAfter)}
                  <p className={`text-[11px] ${r.unitsPct < 0 ? "text-destructive" : "text-success"}`}>{signedPct(r.unitsPct, 0)}</p>
                </TableCell>
                <TableCell className="tabular text-right">
                  {pctText(r.marginBefore, 0)} → {pctText(r.marginAfter, 0)}
                </TableCell>
                <TableCell className={`tabular text-right ${r.revenueDeltaCents < 0 ? "text-destructive" : "text-success"}`}>{signedMoney(r.revenueDeltaCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Mostra os {changes.rows.length} de maior receita entre {changes.count} reajustados. “Lucro bruto (% do preço)” usa o custo do catálogo; “—” = produto sem custo cadastrado.
      </p>
    </Block>
  );
}
