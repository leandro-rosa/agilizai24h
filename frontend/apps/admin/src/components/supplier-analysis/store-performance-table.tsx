import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StoreRow } from "@/lib/api/supplier-analysis";
import { SITUATION_TEXT, SITUATION_TONE } from "@/lib/supplier-analysis/format";

/** Onde o produto vende e onde se abastece sem retorno. Pior desempenho primeiro. */
export function StorePerformanceTable({ stores, minRestockedNote }: { stores: StoreRow[]; minRestockedNote?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Desempenho por loja</CardTitle>
      </CardHeader>
      <CardContent>
        {stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma loja com abastecimento, venda ou perda deste produto no período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Loja</TableHead>
                <TableHead className="text-right">Abastecido</TableHead>
                <TableHead className="text-right">Vendido</TableHead>
                <TableHead className="text-right">Perdido</TableHead>
                <TableHead className="text-right">Venda/Abastecimento</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((store) => (
                <TableRow key={store.storeId}>
                  <TableCell className="font-medium">{store.storeName ?? `Loja ${store.storeId}`}</TableCell>
                  <TableCell className="tabular text-right">{store.restocked}</TableCell>
                  <TableCell className="tabular text-right">{store.sold}</TableCell>
                  <TableCell className="tabular text-right">{store.lost}</TableCell>
                  <TableCell className="tabular text-right">{store.sellThrough === null ? "—" : `${Math.round(store.sellThrough * 100)}%`}</TableCell>
                  <TableCell>
                    {store.situation ? (
                      <StatusBadge tone={SITUATION_TONE[store.situation]}>{SITUATION_TEXT[store.situation]}</StatusBadge>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="Poucas unidades abastecidas para classificar.">
                        Sem base
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {minRestockedNote && <p className="mt-2 text-xs text-muted-foreground">Cortes de situação são premissas provisórias, ainda em calibração.</p>}
      </CardContent>
    </Card>
  );
}
