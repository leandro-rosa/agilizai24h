import { Package } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { count, period as fmtPeriod } from "@/lib/format";
import { signedPct, signedPp } from "@/lib/overview/compare";
import { BEHAVIOR_LABELS } from "@/lib/overview/product-behavior";
import type { ProductRow, ProductsSummary } from "@/lib/overview/types";
import { Block, moneyRound, pctText, Unavailable } from "./shared";
import { Sparkline } from "./sparkline";

function Row({ r }: { r: ProductRow }) {
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
          <span className="text-xs text-muted-foreground">{BEHAVIOR_LABELS[r.behavior]}</span>
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-normal">
        {r.distribution && r.distribution.storesAffected > 0
          ? r.distribution.concentrated
            ? `${Math.round((r.distribution.topShare ?? 0) * 100)}% em 2 lojas`
            : `em ${r.distribution.storesAffected} lojas`
          : "—"}
      </TableCell>
    </TableRow>
  );
}

function Rows({ rows, empty }: { rows: ProductRow[]; empty: string }) {
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
          <TableHead>Distribuição</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows.map((r) => <Row key={r.sku} r={r} />)}</TableBody>
    </Table>
  );
}

export function ProductsCard({ products, loading, previousPeriod }: { products: ProductsSummary | null; loading: boolean; previousPeriod: string }) {
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
            <TabsContent value="top"><Rows rows={products.topSold} empty="Sem vendas no mês." /></TabsContent>
            <TabsContent value="up"><Rows rows={products.rising} empty={products.hasComparison ? "Nenhum produto com alta material." : `Sem vendas de ${fmtPeriod(previousPeriod)} importadas para comparar.`} /></TabsContent>
            <TabsContent value="down"><Rows rows={products.falling} empty={products.hasComparison ? "Nenhum produto com queda material." : `Sem vendas de ${fmtPeriod(previousPeriod)} importadas para comparar.`} /></TabsContent>
            <TabsContent value="change"><Rows rows={products.relevantChange} empty="Nenhuma mudança de comportamento relevante." /></TabsContent>
          </div>
          <p className="pt-2 text-xs text-muted-foreground">Margem = (receita − custo unitário datado × unidades) ÷ receita, só sobre SKUs com custo resolvido. Classificações são evidência, não decisão.</p>
        </Tabs>
      )}
    </Block>
  );
}
