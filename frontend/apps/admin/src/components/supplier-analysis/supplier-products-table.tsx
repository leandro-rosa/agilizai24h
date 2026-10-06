import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ProductLine } from "@/lib/api/supplier-analysis";
import { changeTone, formatChange, formatFigure, hasMovement } from "@/lib/supplier-analysis/format";
import { MarginBar } from "./margin-bar";
import { cn } from "@/lib/utils";

const TONE_CLASS = { positive: "text-success", critical: "text-destructive", neutral: "text-muted-foreground" } as const;

/** Produtos do fornecedor: comprado, abastecido, vendido, perdido, custo, receita, margem e variação das vendas. */
export function SupplierProductsTable({
  lines,
  onSelect,
  attentionThreshold = 0.2,
  attentionSkus = [],
}: {
  lines: ProductLine[];
  onSelect?: (sku: string) => void;
  /** Margem abaixo da qual o produto pede atenção (parâmetro do backend). */
  attentionThreshold?: number;
  attentionSkus?: string[];
}) {
  const [showIdle, setShowIdle] = useState(false);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const active = lines.filter((line) => hasMovement(line.movement));
  const idle = lines.length - active.length;
  const attention = new Set(attentionSkus);
  const visible = (showIdle ? lines : active).filter((line) => !onlyAttention || attention.has(line.sku));

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
                <TableHead className="text-right">Custo médio</TableHead>
                <TableHead className="text-right">Preço médio</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Lucro bruto</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Markup</TableHead>
                <TableHead className="text-right">Variação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((line) => {
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
                    <TableCell className="tabular text-right">{formatFigure(line.movement.avgPriceCents, "cents")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.revenueCents, "cents")}</TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.grossProfitCents, "cents")}</TableCell>
                    <TableCell className="text-right">
                      <MarginBar margin={line.movement.marginShare} threshold={attentionThreshold} />
                    </TableCell>
                    <TableCell className="tabular text-right">{formatFigure(line.movement.markup, "ratio")}</TableCell>
                    <TableCell className={cn("tabular text-right", TONE_CLASS[changeTone(change, true)])}>{label ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {lines.length > 0 && active.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum produto deste fornecedor teve compra, abastecimento, venda ou perda neste mês.</p>
        )}
        {attentionSkus.length > 0 && (
          <Button variant={onlyAttention ? "secondary" : "ghost"} size="sm" className="mr-2 mt-2" aria-pressed={onlyAttention} onClick={() => setOnlyAttention((value) => !value)}>
            {onlyAttention ? "Mostrando só produtos com atenção" : `Só produtos com atenção (${attentionSkus.length})`}
          </Button>
        )}
        {idle > 0 && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowIdle((value) => !value)}>
            {showIdle ? "Ocultar produtos sem movimento" : `Mostrar ${idle} ${idle === 1 ? "produto sem movimento" : "produtos sem movimento"} no mês`}
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Variação = vendas contra o período de comparação. Margem = (receita − custo) ÷ receita; markup = preço ÷ custo; ambos só sobre SKUs com custo cadastrado. Atenção = margem abaixo de {Math.round(attentionThreshold * 100)}% (premissa, calibrável).</p>
      </CardContent>
    </Card>
  );
}
