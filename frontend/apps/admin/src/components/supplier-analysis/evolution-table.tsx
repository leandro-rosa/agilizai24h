import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Figure, MonthlyPoint } from "@/lib/api/supplier-analysis";
import { formatFigure, formatMonth } from "@/lib/supplier-analysis/format";

const ROWS: { key: keyof Omit<MonthlyPoint, "month">; label: string }[] = [
  { key: "purchasedUnits", label: "Comprado" },
  { key: "restocked", label: "Abastecido" },
  { key: "sold", label: "Vendido" },
  { key: "lost", label: "Perdido" },
];

function Cell({ figure }: { figure: Figure }) {
  return (
    <TableCell className="tabular text-right">
      {figure.available ? (
        formatFigure(figure, "units").replace(" un.", "")
      ) : (
        <span className="text-xs text-muted-foreground" title={formatFigure(figure, "units")}>
          {figure.reason === "no_purchase_history" ? "Sem histórico de compras" : "—"}
        </span>
      )}
    </TableCell>
  );
}

/** Últimos meses lado a lado. Mês sem compra registrada diz "Sem histórico de compras", nunca zero. */
export function EvolutionTable({ points }: { points: MonthlyPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evolução mensal</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              {points.map((point) => (
                <TableHead key={point.month} className="text-right">
                  {formatMonth(point.month)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                {points.map((point) => (
                  <Cell key={point.month} figure={point[row.key]} />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
