import { useMemo } from "react";

import { RequestState } from "@/components/request-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetStockRangeQuery } from "@/lib/api/inventory";
import { useGetProductsQuery } from "@/lib/api/products";
import { period as fmtPeriod } from "@/lib/format";
import { buildPending, PENDING_BASELINE } from "@/lib/reconciliation-pending";

const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (p: string) => months[Number(p.split("-")[1]) - 1];

/**
 * Pendências de uma loja desde julho: produtos cujo saldo, partindo da contagem de fim de junho, ficaria negativo — ou seja, houve
 * venda ou retirada sem abastecimento registrado que a sustente. Só localiza onde corrigir; não muda nenhuma cifra da reconciliação.
 */
export function PendingDialog({ store, endPeriod, onClose }: { store: { id: number; name: string } | null; endPeriod: string; onClose: () => void }) {
  const beforeBaseline = endPeriod < PENDING_BASELINE;
  const openingPeriod = useMemo(() => {
    const [y, m] = PENDING_BASELINE.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }, []);
  const skip = !store || beforeBaseline;
  const movements = useGetStockRangeQuery({ storeId: store?.id ?? 0, range: { start: PENDING_BASELINE, end: endPeriod } }, { skip });
  const opening = useGetStockRangeQuery({ storeId: store?.id ?? 0, range: { start: openingPeriod, end: openingPeriod } }, { skip });
  const { data: products } = useGetProductsQuery();
  const names = useMemo(() => new Map((products ?? []).map((p) => [p.sku, p.name])), [products]);

  const summary = useMemo(() => (movements.data ? buildPending(movements.data.items, opening.data?.items ?? null) : null), [movements.data, opening.data]);
  const isLoading = movements.isLoading || opening.isLoading;

  return (
    <Dialog open={store !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Pendências de {store?.name} desde {monthName(PENDING_BASELINE)}</DialogTitle>
          <DialogDescription>
            Produtos em que saiu mais do que entrou: contando a partir do estoque contado no fim de {monthName(openingPeriod)}, mais os abastecimentos, menos as vendas e
            retiradas de {monthName(PENDING_BASELINE)} até {monthName(endPeriod)}, o saldo ficaria negativo. Antes de {monthName(PENDING_BASELINE)} o histórico tem muitos erros e não é analisado aqui.
          </DialogDescription>
        </DialogHeader>
        {beforeBaseline ? (
          <p className="text-sm text-muted-foreground">O período escolhido termina antes de {monthName(PENDING_BASELINE)}; escolha {monthName(PENDING_BASELINE)} ou depois.</p>
        ) : (
          <RequestState isLoading={isLoading} error={movements.error ?? opening.error} isEmpty={!isLoading && !summary} emptyMessage="Sem movimento de estoque neste período." onRetry={() => { movements.refetch(); opening.refetch(); }}>
            {summary && (
              <div className="flex flex-col gap-4">
                {summary.productCount === 0 ? (
                  <p className="text-sm font-medium text-success">Nenhuma pendência desde {monthName(PENDING_BASELINE)}: nada saiu a mais do que entrou.</p>
                ) : (
                  <>
                    <p className="text-sm">
                      <span className="font-semibold">{summary.productCount} produtos</span> com saldo negativo e{" "}
                      <span className="font-semibold">{summary.missingUnits} unidades</span> vendidas ou retiradas sem abastecimento registrado.{" "}
                      {summary.neverRestockedCount > 0 && `${summary.neverRestockedCount} deles não têm nenhum abastecimento registrado no período. `}
                      {summary.withoutOpeningCount > 0 && `${summary.withoutOpeningCount} não tinham contagem de fim de ${monthName(openingPeriod)} (contei como zero).`}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right" title={`Estoque contado no fim de ${fmtPeriod(openingPeriod)}`}>Contagem de {monthName(openingPeriod)}</TableHead>
                          <TableHead className="text-right">Abastecido</TableHead>
                          <TableHead className="text-right">Vendido</TableHead>
                          <TableHead className="text-right">Retirado</TableHead>
                          <TableHead className="text-right" title="Contagem + abastecido − vendido − retirado + ajuste">Saldo</TableHead>
                          <TableHead>O que olhar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.rows.slice(0, 50).map((r) => (
                          <TableRow key={r.sku}>
                            <TableCell className="max-w-64 truncate font-medium" title={`${names.get(r.sku) ?? r.sku} (código ${r.sku})`}>{names.get(r.sku) ?? r.sku}</TableCell>
                            <TableCell className="tabular text-right">{r.opening === null ? "sem contagem" : r.opening}</TableCell>
                            <TableCell className="tabular text-right">{r.restocked}</TableCell>
                            <TableCell className="tabular text-right">{r.sold}</TableCell>
                            <TableCell className="tabular text-right">{r.removed}</TableCell>
                            <TableCell className="tabular text-right font-semibold text-destructive">{r.expected}</TableCell>
                            <TableCell className="whitespace-normal text-xs text-muted-foreground">
                              {r.neverRestocked ? "Vendeu sem nenhum abastecimento lançado" : `Faltam ${r.missing} un. de abastecimento ou de contagem`}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {summary.rows.length > 50 && <p className="text-xs text-muted-foreground">Mostrando os 50 maiores de {summary.rows.length}, por unidades faltando.</p>}
                    <p className="text-xs text-muted-foreground">
                      Vale conferir se o abastecimento desses produtos foi lançado, se a linha foi recusada na importação (código desconhecido) ou se a contagem de fim de {monthName(openingPeriod)} está certa.
                      Esta lista só aponta onde olhar: não diz o motivo e não altera os números da reconciliação.
                    </p>
                  </>
                )}
              </div>
            )}
          </RequestState>
        )}
      </DialogContent>
    </Dialog>
  );
}
