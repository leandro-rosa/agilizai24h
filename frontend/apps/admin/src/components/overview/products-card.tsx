import { Package } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { count, period as fmtPeriod } from "@/lib/format";
import { signedPct, signedPp } from "@/lib/overview/compare";
import { BEHAVIOR_LABELS, distributionText } from "@/lib/overview/product-behavior";
import type { ProductRow, ProductsSummary } from "@/lib/overview/types";
import { Block, moneyRound, pctText, Unavailable } from "./shared";
import { Sparkline } from "./sparkline";

function Row({ r, onOpen }: { r: ProductRow; onOpen: (r: ProductRow) => void }) {
  const tone = r.behavior === "crescimento_consistente" ? "up" : r.behavior === "queda_consistente" ? "down" : (r.deltaRevenuePct ?? 0) > 0.02 ? "up" : (r.deltaRevenuePct ?? 0) < -0.02 ? "down" : "flat";
  return (
    <TableRow>
      <TableCell className="max-w-48 truncate font-medium" title={r.name}>{r.name}</TableCell>
      <TableCell className="tabular text-right">{count(r.units)}</TableCell>
      <TableCell className="tabular text-right">{moneyRound(r.revenueCents)}</TableCell>
      <TableCell className="tabular text-right" title={r.marginUnresolved ? "Parte das vendas sem custo resolvido — fora da margem" : undefined}>
        {pctText(r.marginPct, 0)}
        {r.marginDeltaPp !== null && Math.abs(r.marginDeltaPp) >= 1 ? <span className="ml-1 text-xs text-muted-foreground">({signedPp(r.marginDeltaPp, 0)})</span> : null}
      </TableCell>
      <TableCell className="tabular text-right">{r.deltaRevenuePct === null ? <span className="text-muted-foreground">sem comparação</span> : signedPct(r.deltaRevenuePct, 0)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Sparkline values={r.series} tone={tone} />
          <span className="text-xs text-muted-foreground" title={r.behavior === "novo" ? "Sem vendas nos meses anteriores: pode ser produto novo OU um produto que trocou de código (SKU). O sistema não liga um código ao outro." : undefined}>{BEHAVIOR_LABELS[r.behavior]}</span>
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <Button variant="link" size="sm" className="h-auto min-w-40 justify-start p-0 text-left text-xs whitespace-normal" onClick={() => onOpen(r)}>
          {distributionText(r.distribution) ?? "Ver lojas"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function Rows({ rows, empty, onOpen }: { rows: ProductRow[]; empty: string; onOpen: (r: ProductRow) => void }) {
  if (rows.length === 0) return <p className="py-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Produto</TableHead>
          <TableHead className="text-right">Unidades</TableHead>
          <TableHead className="text-right">Faturamento</TableHead>
          <TableHead className="text-right">Margem</TableHead>
          <TableHead className="text-right">vs. mês anterior</TableHead>
          <TableHead>Tendência (6 meses)</TableHead>
          <TableHead>Por loja (clique)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows.map((r) => <Row key={r.sku} r={r} onOpen={onOpen} />)}</TableBody>
    </Table>
  );
}

export function ProductsCard({ products, loading, previousPeriod }: { products: ProductsSummary | null; loading: boolean; previousPeriod: string }) {
  const [open, setOpen] = useState<ProductRow | null>(null);
  return (
    <Block title="Produtos — desempenho do mês" icon={<Package className="size-4 text-primary" />} href="/commercial-intelligence" className="min-w-0">
      {loading && !products ? (
        <p className="text-sm text-muted-foreground">Carregando vendas de todas as lojas…</p>
      ) : !products ? (
        <Unavailable what="vendas do mês não importadas" />
      ) : (
        <Tabs defaultValue="top">
          <TabsList>
            <TabsTrigger value="top">Mais vendidos</TabsTrigger>
            <TabsTrigger value="up">Em alta</TabsTrigger>
            <TabsTrigger value="down">Em queda</TabsTrigger>
            <TabsTrigger value="change">Mudança relevante</TabsTrigger>
          </TabsList>
          <div className="overflow-x-auto">
            <TabsContent value="top"><Rows onOpen={setOpen} rows={products.topSold} empty="Sem vendas no mês." /></TabsContent>
            <TabsContent value="up"><Rows onOpen={setOpen} rows={products.rising} empty={products.hasComparison ? "Nenhum produto com alta material." : `Sem vendas de ${fmtPeriod(previousPeriod)} importadas para comparar.`} /></TabsContent>
            <TabsContent value="down"><Rows onOpen={setOpen} rows={products.falling} empty={products.hasComparison ? "Nenhum produto com queda material." : `Sem vendas de ${fmtPeriod(previousPeriod)} importadas para comparar.`} /></TabsContent>
            <TabsContent value="change"><Rows onOpen={setOpen} rows={products.relevantChange} empty="Nenhuma mudança de comportamento relevante." /></TabsContent>
          </div>
          <p className="pt-2 text-xs text-muted-foreground">Margem = (receita − custo unitário datado × unidades) ÷ receita, só sobre SKUs com custo resolvido. Classificações são evidência, não decisão.</p>
        </Tabs>
      )}
      <ProductStoresDialog row={open} onClose={() => setOpen(null)} previousPeriod={previousPeriod} />
    </Block>
  );
}

/**
 * Em quais lojas o produto vendeu e em quais não. "Sem venda no mês" NÃO diz que
 * a loja não tem o produto no mix — só que não houve venda registrada; pode ser
 * produto fora do mix, falta de abastecimento ou venda zerada.
 */
function ProductStoresDialog({ row, onClose, previousPeriod }: { row: ProductRow | null; onClose: () => void; previousPeriod: string }) {
  const sold = row?.byStore.filter((x) => x.units > 0).sort((a, b) => b.units - a.units) ?? [];
  const notSold = row?.byStore.filter((x) => x.units === 0).sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  const hadBefore = notSold.filter((x) => (x.unitsPrevious ?? 0) > 0);
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row?.name}</DialogTitle>
          <DialogDescription>
            Vendeu em {sold.length} de {row?.byStore.length ?? 0} lojas ativas no mês. Unidades vendidas, mês vs. {fmtPeriod(previousPeriod)}.
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead className="text-right">Mês anterior</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sold.map((x) => (
              <TableRow key={x.storeId}>
                <TableCell>{x.name}</TableCell>
                <TableCell className="tabular text-right">{count(x.units)}</TableCell>
                <TableCell className="tabular text-right">{x.unitsPrevious === null ? "—" : count(x.unitsPrevious)}</TableCell>
                <TableCell className="tabular text-right">{moneyRound(x.revenueCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">Sem venda no mês ({notSold.length} lojas)</p>
          {notSold.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todas as lojas ativas venderam este produto.</p>
          ) : (
            <>
              <p className="text-sm">{notSold.map((x) => x.name).join(", ")}</p>
              {hadBefore.length > 0 && <p className="text-xs text-warning">Venderam no mês anterior e pararam: {hadBefore.map((x) => x.name).join(", ")}.</p>}
              <p className="text-xs text-muted-foreground">Sem venda registrada não significa que a loja não tenha o produto no mix: pode ser falta de abastecimento ou venda zerada.</p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
