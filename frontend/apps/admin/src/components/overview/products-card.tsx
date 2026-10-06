import { Package } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { count, period as fmtPeriod } from "@/lib/format";
import { signedPct } from "@/lib/overview/compare";
import { BEHAVIOR_LABELS, distributionText } from "@/lib/overview/product-behavior";
import { baseText } from "@/lib/overview/ranking";
import type { ProductRow, ProductsSummary } from "@/lib/overview/types";
import { Block, moneyRound, NoData, pctText, Unavailable } from "./shared";
import { Sparkline } from "./sparkline";

/** Resumo executivo: só 5 linhas por aba e 5 colunas. A análise por loja abre ao clicar no produto. */
const ROWS = 5;

function Row({ r, onOpen }: { r: ProductRow; onOpen: (r: ProductRow) => void }) {
  const tone = r.behavior === "crescimento_consistente" ? "up" : r.behavior === "queda_consistente" ? "down" : (r.deltaRevenuePct ?? 0) > 0.02 ? "up" : (r.deltaRevenuePct ?? 0) < -0.02 ? "down" : "flat";
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpen(r)}>
      <TableCell className="max-w-56 truncate font-medium">
        <button type="button" className="max-w-full truncate text-left hover:underline" title={`Ver por loja: ${r.name}`} onClick={() => onOpen(r)}>
          {r.name}
        </button>
      </TableCell>
      <TableCell className="tabular text-right">{count(r.units)}</TableCell>
      <TableCell className="tabular text-right">{moneyRound(r.revenueCents)}</TableCell>
      <TableCell className="text-right">
        {r.unitsPrevious === null ? (
          <span className="text-xs text-muted-foreground">sem base</span>
        ) : (
          <>
            <p className="tabular text-sm">{r.deltaUnitsPct === null ? "novo no mês" : signedPct(r.deltaUnitsPct, 0)}</p>
            {/* A base sempre à vista: "+1.087%" sozinho engana, "1 → 12 un." não. */}
            <p className="tabular text-[11px] text-muted-foreground">{baseText(r.unitsPrevious, r.units, (n) => count(n), "un.")}</p>
          </>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Sparkline values={r.series} tone={tone} />
          <span className="hidden text-xs text-muted-foreground 2xl:inline" title={r.behavior === "novo" ? "Sem vendas nos meses anteriores: pode ser produto novo OU um produto que trocou de código de barras." : undefined}>
            {BEHAVIOR_LABELS[r.behavior]}
          </span>
        </div>
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
          <TableHead className="text-right">Receita</TableHead>
          <TableHead className="text-right">vs. mês anterior</TableHead>
          <TableHead>Tendência</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows.slice(0, ROWS).map((r) => <Row key={r.sku} r={r} onOpen={onOpen} />)}</TableBody>
    </Table>
  );
}

export function ProductsCard({ products, loading, previousPeriod, unavailable }: { products: ProductsSummary | null; loading: boolean; previousPeriod: string; unavailable?: boolean }) {
  const [open, setOpen] = useState<ProductRow | null>(null);
  const noBase = `Sem vendas de ${fmtPeriod(previousPeriod)} importadas para comparar.`;
  return (
    <Block title="Produtos — desempenho do mês" icon={<Package className="size-4 text-primary" />} href="/commercial-intelligence" className="min-w-0">
      {unavailable ? (
        <Unavailable what="erro ao buscar vendas" />
      ) : loading && !products ? (
        <p className="text-sm text-muted-foreground">Carregando vendas de todas as lojas…</p>
      ) : !products ? (
        <NoData what="vendas do mês não importadas" />
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
            <TabsContent value="up"><Rows onOpen={setOpen} rows={products.rising} empty={products.hasComparison ? "Nenhum produto com alta material." : noBase} /></TabsContent>
            <TabsContent value="down"><Rows onOpen={setOpen} rows={products.falling} empty={products.hasComparison ? "Nenhum produto com queda material." : noBase} /></TabsContent>
            <TabsContent value="change"><Rows onOpen={setOpen} rows={products.relevantChange} empty="Nenhuma mudança de comportamento relevante." /></TabsContent>
          </div>
          <p className="pt-2 text-xs text-muted-foreground">Clique no produto para ver quais lojas venderam. Mostra os {ROWS} mais relevantes de cada aba; o restante está em “Ver análise completa”.</p>
        </Tabs>
      )}
      <ProductStoresDialog row={open} onClose={() => setOpen(null)} previousPeriod={previousPeriod} />
    </Block>
  );
}

/**
 * Análise por loja, aberta ao clicar no produto. "Sem venda no mês" NÃO diz que a loja
 * não tem o produto no mix — só que não houve venda registrada; pode ser produto fora
 * do mix, falta de abastecimento ou venda zerada.
 */
function ProductStoresDialog({ row, onClose, previousPeriod }: { row: ProductRow | null; onClose: () => void; previousPeriod: string }) {
  const sold = row?.byStore.filter((x) => x.units > 0).sort((a, b) => b.units - a.units) ?? [];
  const notSold = row?.byStore.filter((x) => x.units === 0).sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  const hadBefore = notSold.filter((x) => (x.unitsPrevious ?? 0) > 0);
  const dist = row ? distributionText(row.distribution) : null;
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row?.name}</DialogTitle>
          <DialogDescription>
            Vendeu em {sold.length} de {row?.byStore.length ?? 0} lojas ativas no mês. Unidades vendidas, mês vs. {fmtPeriod(previousPeriod)}.
            {dist ? ` ${dist[0].toUpperCase()}${dist.slice(1)}.` : ""}
            {row && row.marginPct !== null ? ` Lucro bruto de ${pctText(row.marginPct, 0)} do preço (custo do catálogo)${row.marginUnresolved ? ", parte das vendas sem custo cadastrado" : ""}.` : ""}
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
