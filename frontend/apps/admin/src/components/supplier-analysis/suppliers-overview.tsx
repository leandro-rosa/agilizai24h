"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetSupplierAnalysisQuery, type AnalysisArgs } from "@/lib/api/supplier-analysis";
import { formatFigure } from "@/lib/supplier-analysis/format";

type Base = AnalysisArgs;

/** Uma linha por fornecedor com os números do período; clicar abre a visão completa. Cada linha só consulta depois de um pequeno atraso, para não pedir tudo de uma vez. */
function Row({ supplier, label, base, delayMs, onSelect }: { supplier: { id: number }; label: string; base: Base; delayMs: number; onSelect: (id: number) => void }) {
  const [ready, setReady] = useState(delayMs === 0);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(timer);
  }, [ready, delayMs]);
  const query = useGetSupplierAnalysisQuery({ ...base, supplierId: supplier.id }, { skip: !ready });
  const current = query.data?.totals.current;
  const cell = (render: () => string) => (current ? render() : query.isError ? "—" : "…");

  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="tabular text-right">{cell(() => formatFigure(current!.purchasedCents, "cents"))}</TableCell>
      <TableCell className="tabular text-right">{cell(() => formatFigure(current!.restocked, "units"))}</TableCell>
      <TableCell className="tabular text-right">{cell(() => formatFigure(current!.sold, "units"))}</TableCell>
      <TableCell className="tabular text-right">{cell(() => formatFigure(current!.lossCents, "cents"))}</TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" onClick={() => onSelect(supplier.id)} aria-label={`Abrir ${label}`}>
          Abrir
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function SuppliersOverview({ suppliers, base, onSelect }: { suppliers: { id: number; label: string }[]; base: Base; onSelect: (id: number) => void }) {
  if (suppliers.length === 0) return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum fornecedor com produtos vinculados nesta categoria.</p>;

  return (
    <div className="min-w-0 overflow-x-auto">
      <p className="pb-2 text-xs text-muted-foreground">Escolha um fornecedor (ou clique em “Abrir”) para ver a movimentação completa. Compra, abastecimento, venda e perda do período e da loja filtrada.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fornecedor</TableHead>
            <TableHead className="text-right">Comprado</TableHead>
            <TableHead className="text-right">Abastecido</TableHead>
            <TableHead className="text-right">Vendido</TableHead>
            <TableHead className="text-right">Perda</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.map((supplier, index) => (
            <Row key={supplier.id} supplier={supplier} label={supplier.label} base={base} delayMs={index * 350} onSelect={onSelect} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
