"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StorePeriodPicker, currentPeriod } from "@/components/store-period-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetReconciliationQuery } from "@/lib/api/finance";
import { LOSS_COUNTING_REASONS, reasonLabel } from "@/lib/removal-reasons";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function Figure({ label, cents, incomplete }: { label: string; cents: number; incomplete?: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-baseline gap-2 text-2xl font-semibold">
        {currency.format(cents / 100)}
        {incomplete && (
          <span title="Calculado a partir de uma reconciliação incompleta — não é uma cifra final.">
            <AlertTriangle className="size-4 text-warning" />
          </span>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinancePage() {
  const [storeId, setStoreId] = useState<number | null>(null);
  const [period, setPeriod] = useState(currentPeriod());

  const { data: products } = useGetProductsQuery();
  const nameBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products ?? []) map.set(product.sku, product.name);
    return map;
  }, [products]);

  const query = storeId === null ? undefined : { storeId, period };
  const { data: reconciliation, isLoading, error, refetch } = useGetReconciliationQuery(
    query ?? { storeId: 0, period },
    { skip: !query },
  );

  const notComputed = error && "status" in error && error.status === 404;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Financeiro" description="A reconciliação mensal: valor abastecido, CMV, sobra e perda real." />

      <StorePeriodPicker storeId={storeId} onStoreIdChange={setStoreId} period={period} onPeriodChange={setPeriod} />

      {storeId === null ? (
        <p className="text-sm text-muted-foreground">Selecione uma loja para ver a reconciliação do período.</p>
      ) : (
        <RequestState
          isLoading={isLoading}
          error={notComputed ? undefined : error}
          isEmpty={notComputed}
          emptyMessage="Esta loja ainda não tem reconciliação para este período."
          onRetry={refetch}
        >
          {reconciliation && (
            <div className="flex flex-col gap-6">
              {/* Incompleteness surfaced right next to the figures, not only on a
                  separate screen — an incomplete total is never presented as final. */}
              {!reconciliation.complete && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/15 px-3 py-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Reconciliação incompleta — as cifras abaixo não são finais.</p>
                    {reconciliation.unvalued.length > 0 && (
                      <p>
                        {reconciliation.unvalued.length} SKU(s) sem custo:{" "}
                        {reconciliation.unvalued.map((u) => u.sku).join(", ")}
                      </p>
                    )}
                    {reconciliation.inconsistent_stock.length > 0 && (
                      <p>
                        {reconciliation.inconsistent_stock.length} SKU(s) com saldo inconsistente:{" "}
                        {reconciliation.inconsistent_stock.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Figure label="Valor abastecido" cents={reconciliation.restocked_value_cents} incomplete={!reconciliation.complete} />
                <Figure label="CMV" cents={reconciliation.cogs_cents} incomplete={!reconciliation.complete} />
                <Figure label="Valor da sobra" cents={reconciliation.remaining_value_cents} incomplete={!reconciliation.complete} />
                <Figure label="Perda real" cents={reconciliation.loss_value_cents} incomplete={!reconciliation.complete} />
                <Figure
                  label="Ajuste de inventário"
                  cents={reconciliation.unclassified_stock_adjustment_value_cents}
                  incomplete={!reconciliation.complete}
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h2 className="mb-2 text-sm font-medium">Perda por motivo</h2>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Só Validade vencida, Produto danificado e Outro motivo contam como perda — Devolução,
                    Transferência e Uso e consumo tiram o produto da prateleira, mas não são perda.
                  </p>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Motivo</TableHead>
                          <TableHead className="text-right">Qtd.</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconciliation.loss_by_reason.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground">
                              Sem perda registrada no período.
                            </TableCell>
                          </TableRow>
                        ) : (
                          reconciliation.loss_by_reason.map((entry) => (
                            <TableRow key={entry.reason}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {reasonLabel(entry.reason)}
                                  {LOSS_COUNTING_REASONS.has(entry.reason) && (
                                    <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">
                                      Perda
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{entry.quantity}</TableCell>
                              <TableCell className="text-right">{currency.format(entry.value_cents / 100)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div>
                  <h2 className="mb-2 text-sm font-medium">Perda por produto</h2>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produto</TableHead>
                          <TableHead className="text-right">Qtd.</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconciliation.loss_by_sku.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground">
                              Sem perda registrada no período.
                            </TableCell>
                          </TableRow>
                        ) : (
                          reconciliation.loss_by_sku.map((entry) => (
                            <TableRow key={entry.sku}>
                              <TableCell>{nameBySku.get(entry.sku) ?? entry.sku}</TableCell>
                              <TableCell className="text-right">{entry.quantity}</TableCell>
                              <TableCell className="text-right">{currency.format(entry.value_cents / 100)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </RequestState>
      )}
    </div>
  );
}
