"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { RestockDisplayRow } from "./restock-table";

function effectiveAction(row: RestockDisplayRow): string {
  return row.kind === "oportunidade" ? "testar" : row.data.acao;
}

function suggestedQuantity(row: RestockDisplayRow): number {
  return row.kind === "oportunidade" ? row.data.quantidadeTeste : row.data.quantidadeSugeridaIA;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="tabular text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Resumo estático — nunca um "impacto financeiro potencial" não calibrado (pedido do operador). */
export function RestockPanel({ rows, windowLabel }: { rows: RestockDisplayRow[]; windowLabel: string }) {
  const levar = rows.filter((r) => ["aumentar", "manter"].includes(effectiveAction(r))).length;
  const reduzir = rows.filter((r) => effectiveAction(r) === "reduzir").length;
  const naoLevar = rows.filter((r) => effectiveAction(r) === "nao_abastecer").length;
  const testar = rows.filter((r) => effectiveAction(r) === "testar").length;
  const unidadesSugeridas = rows.reduce((sum, r) => sum + suggestedQuantity(r), 0);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{windowLabel}</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat value={levar} label="produtos para levar" />
          <Stat value={unidadesSugeridas} label="unidades sugeridas" />
          <Stat value={reduzir} label="produtos para reduzir" />
          <Stat value={naoLevar} label="produtos para não abastecer" />
          <Stat value={testar} label="oportunidades de teste" />
        </div>
      </CardContent>
    </Card>
  );
}
