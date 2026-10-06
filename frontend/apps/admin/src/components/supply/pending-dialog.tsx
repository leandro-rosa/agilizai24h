import { useMemo, useState } from "react";

import type { ComponentProps } from "react";

import { RequestState } from "@/components/request-state";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MonthItems } from "@/lib/api/inventory";
import { useGetProductsQuery } from "@/lib/api/products";
import { buildMonthlyPending, PENDING_BASELINE, pendingMonths, pendingTrend, type PendingRow } from "@/lib/reconciliation-pending";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (p: string) => MONTHS[Number(p.split("-")[1]) - 1];
const monthShort = (p: string) => monthName(p).slice(0, 3);

/** O que a linha indica, em palavras simples — sem afirmar a causa. */
function indication(r: PendingRow): string {
  if (r.kind === "entrada_nao_lancada") return `Há ${r.countEnd} contadas no fim do mês, então o produto estava na loja, mas faltam ~${r.missing} un. de entrada lançada`;
  const had = `${r.opening ?? 0} do mês anterior${r.restocked > 0 ? ` + ${r.restocked} abastecidas` : " e nenhum abastecimento lançado"}`;
  return `Saíram ${r.sold + r.removed} e só havia ${had}${r.opening === null ? " (sem contagem do mês anterior; contei como zero)" : ""}`;
}

/**
 * Pendências de uma loja, mês a mês. Em cada mês o ponto de partida é a contagem de fim do mês anterior: venda sem abastecimento pode ser estoque que
 * sobrou do mês passado. Só localiza onde corrigir; não muda nenhuma cifra da reconciliação e não afirma o motivo.
 */
export function PendingDialog({
  store,
  endPeriod,
  months,
  isLoading,
  error,
  onRetry,
  onClose,
}: {
  store: { id: number; name: string } | null;
  endPeriod: string;
  months: MonthItems[] | undefined;
  isLoading: boolean;
  error: ComponentProps<typeof RequestState>["error"];
  onRetry: () => void;
  onClose: () => void;
}) {
  const analyzed = useMemo(() => pendingMonths(endPeriod), [endPeriod]);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked && analyzed.includes(picked) ? picked : endPeriod;
  const { data: products } = useGetProductsQuery();
  const names = useMemo(() => new Map((products ?? []).map((p) => [p.sku, p.name])), [products]);

  const pending = useMemo(() => (months ? buildMonthlyPending(months, month) : null), [months, month]);
  const trend = useMemo(() => (months ? pendingTrend(months, endPeriod) : []), [months, endPeriod]);

  return (
    <Dialog open={store !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Pendências de {store?.name} em {monthName(month)}</DialogTitle>
          <DialogDescription>
            Produtos em que saiu mais do que entrou no mês. A conta parte do estoque contado no fim de {monthName(pending?.openingPeriod ?? month)}, soma o abastecido do mês e subtrai vendas e retiradas:
            venda sem abastecimento no mês pode ser estoque que sobrou do mês anterior, e isso já está contado. Antes de {monthName(PENDING_BASELINE)} o histórico tem muitos erros e não é analisado.
          </DialogDescription>
        </DialogHeader>
        {analyzed.length === 0 ? (
          <p className="text-sm text-muted-foreground">O período escolhido termina antes de {monthName(PENDING_BASELINE)}; escolha {monthName(PENDING_BASELINE)} ou depois.</p>
        ) : (
          <RequestState isLoading={isLoading} error={error} isEmpty={!isLoading && !months} emptyMessage="Sem movimento de estoque neste período." onRetry={onRetry}>
            {pending && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Tabs value={month} onValueChange={setPicked}>
                    <TabsList>
                      {analyzed.map((m) => (
                        <TabsTrigger key={m} value={m}>{monthName(m)}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  {trend.length > 1 && (
                    <p className="text-sm text-muted-foreground">
                      Produtos pendentes: {trend.map((t) => `${monthShort(t.month)} ${t.hasData ? t.count : "sem dados"}`).join(" → ")}
                    </p>
                  )}
                </div>
                {!pending.hasData ? (
                  <p className="text-sm text-muted-foreground">Nenhum registro de estoque de {monthName(month)} para esta loja (nada importado). Isso não quer dizer “sem pendências”.</p>
                ) : pending.productCount === 0 ? (
                  <p className="text-sm font-medium text-success">Nenhuma pendência em {monthName(month)}: nada saiu a mais do que entrou, considerando o estoque do mês anterior.</p>
                ) : (
                  <>
                    <p className="text-sm">
                      <span className="font-semibold">{pending.productCount} de {pending.productsInMonth} produtos</span> com saldo negativo em {monthName(month)}.{" "}
                      {pending.entryNotLoggedCount > 0 && `${pending.entryNotLoggedCount} têm estoque contado no fim do mês (faltou lançar entrada). `}
                      {pending.withoutOpeningCount > 0 && `${pending.withoutOpeningCount} não tinham contagem de fim de ${monthName(pending.openingPeriod)} (contei como zero).`}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right" title={`Estoque contado no fim de ${monthName(pending.openingPeriod)}`}>Veio do mês anterior</TableHead>
                          <TableHead className="text-right">Abastecido</TableHead>
                          <TableHead className="text-right">Vendido</TableHead>
                          <TableHead className="text-right">Retirado</TableHead>
                          <TableHead className="text-right" title="Veio do mês anterior + abastecido − vendido − retirado + ajuste">Saldo esperado</TableHead>
                          <TableHead className="text-right" title={`Estoque contado no fim de ${monthName(month)}`}>Contado no fim</TableHead>
                          <TableHead>O que isso indica</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pending.rows.slice(0, 50).map((r) => (
                          <TableRow key={r.sku}>
                            <TableCell className="max-w-56 truncate font-medium" title={`${names.get(r.sku) ?? r.sku} (código ${r.sku})`}>{names.get(r.sku) ?? r.sku}</TableCell>
                            <TableCell className="tabular text-right">{r.opening === null ? "sem contagem" : r.opening}</TableCell>
                            <TableCell className="tabular text-right">{r.restocked}</TableCell>
                            <TableCell className="tabular text-right">{r.sold}</TableCell>
                            <TableCell className="tabular text-right">{r.removed}</TableCell>
                            <TableCell className="tabular text-right font-semibold text-destructive">{r.expected}</TableCell>
                            <TableCell className="tabular text-right">{r.countEnd === null ? "—" : r.countEnd}</TableCell>
                            <TableCell className="min-w-64 whitespace-normal text-xs text-muted-foreground">{indication(r)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {pending.rows.length > 50 && <p className="text-xs text-muted-foreground">Mostrando os 50 maiores de {pending.rows.length}, por unidades faltando.</p>}
                    <p className="text-xs text-muted-foreground">
                      Vale conferir se o abastecimento desses produtos foi lançado, se a linha foi recusada na importação (código desconhecido) ou se a contagem de fim de {monthName(pending.openingPeriod)} está certa.
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
