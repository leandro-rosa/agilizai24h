import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProductLine } from "@/lib/api/supplier-analysis";
import { changeTone, formatChange, formatFigure } from "@/lib/supplier-analysis/format";
import { cn } from "@/lib/utils";

const TONE_CLASS = { positive: "text-success", critical: "text-destructive", neutral: "text-muted-foreground" } as const;

/** Produtos do fornecedor: comprado, abastecido, vendido, perdido, custo, receita, margem e variação das vendas. */
export function SupplierProductsTable({ lines, onSelect }: { lines: ProductLine[]; onSelect?: (sku: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Produtos do fornecedor</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum produto está vinculado a este fornecedor. Vincule produtos abaixo para ver a movimentação.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Comprado</TableHead>
                <TableHead className="text-right">Abastecido</TableHead>
                <TableHead className="text-right">Vendido</TableHead>
                <TableHead className="text-right">Perdido</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Variação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const change = line.comparison.sold.change;
                const label = formatChange(change);

                return (
                  <TableRow key={line.sku}>
                    <TableCell className="font-medium">
                      {onSelect ? (
                        <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => onSelect(line.sku)}>
                          {line.name}
                        </button>
                      ) : (
                        line.name
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.purchasedUnits, "units").replace(" un.", "")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.restocked, "units").replace(" un.", "")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.sold, "units").replace(" un.", "")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.lost, "units").replace(" un.", "")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.avgCostCents, "cents")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.revenueCents, "cents")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.marginShare, "share")}</TableCell>
                    <TableCell className={cn("tabular text-right", TONE_CLASS[changeTone(change, true)])}>{label ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Variação = vendas contra o período de comparação. Margem sobre os SKUs com custo cadastrado.</p>
      </CardContent>
    </Card>
  );
}
