import { Tag } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { count } from "@/lib/format";
import { signedPct } from "@/lib/overview/compare";
import { priceChangesObservation, type PriceChanges } from "@/lib/overview/price-volume";
import { Block, moneyRound, pctText } from "./shared";

const price = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
const signedMoney = (cents: number) => `${cents < 0 ? "−" : "+"}${moneyRound(Math.abs(cents))}`;

/**
 * Reajustes de preço do mês, produto a produto. Preço = preço REALIZADO (receita ÷ unidades), não o cadastro:
 * o catálogo só tem preço datado de parte dos produtos. É observação — não afirma que o preço causou a variação das unidades.
 */
export function PriceChangesCard({ changes }: { changes: PriceChanges | null }) {
  if (!changes) return null;
  return (
    <Block title="Reajustes de preço no mês" icon={<Tag className="size-4 text-primary" />} href="/products" linkLabel="Ver produtos">
      <p className="text-sm">
        <span className="font-medium">{changes.count} produtos reajustados</span> ({changes.raised} subiram, {changes.lowered} baixaram): efeito do preço{" "}
        <span className="tabular font-semibold">{signedMoney(changes.priceEffectCents)}</span> e das unidades{" "}
        <span className="tabular font-semibold">{signedMoney(changes.volumeEffectCents)}</span> na receita dos reajustados (estimativa).
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead className="text-right">Margem</TableHead>
              <TableHead className="text-right">Receita</TableHead>
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
        Mostra os {changes.rows.length} de maior receita entre {changes.count} reajustados. Observação: {priceChangesObservation(changes)} Margem sobre o preço realizado, com o custo datado do produto; “—” = custo não resolvido.
      </p>
    </Block>
  );
}
