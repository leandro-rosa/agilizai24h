"use client";

import { useMemo, useState } from "react";

import { RequestState } from "@/components/request-state";
import { currency, SimpleKpiCard, type SalesTabProps } from "@/components/sales/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPct } from "@/lib/financial-kpis";
import {
  categoryLabel,
  categoryMix,
  compareMix,
  computePeriodStats,
  onlyOk,
  productAffinity,
  productSalesRows,
  storePerformanceRows,
  type StorePerformanceRow,
} from "@/lib/sales-insights";

type SortKey = "revenue" | "baskets" | "ticket" | "itemsPerBasket" | "marginPct";

function leadCategoryAndProduct(transactions: SalesTabProps["okCurrent"], productBySku: SalesTabProps["productBySku"]) {
  const mix = categoryMix(transactions, productBySku);
  const products = productSalesRows(transactions, productBySku, null).sort((a, b) => b.revenueCents - a.revenueCents);
  return { category: mix[0] ?? null, product: products[0] ?? null };
}

function ComparisonTable({
  rows,
  productBySku,
  networkCurrentByStore,
  sortKey,
  onSortKey,
}: {
  rows: StorePerformanceRow[];
  productBySku: SalesTabProps["productBySku"];
  networkCurrentByStore: SalesTabProps["networkCurrentByStore"];
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
}) {
  const leads = useMemo(() => {
    const map = new Map<number, ReturnType<typeof leadCategoryAndProduct>>();
    for (const row of networkCurrentByStore) {
      map.set(row.store.id, leadCategoryAndProduct(onlyOk(row.transactions), productBySku));
    }
    return map;
  }, [networkCurrentByStore, productBySku]);

  const sorted = useMemo(() => {
    const withKey = rows.map((r) => {
      let value = 0;
      if (sortKey === "revenue") value = r.revenueCents;
      else if (sortKey === "baskets") value = r.basketCount;
      else if (sortKey === "ticket") value = r.ticketAvgCents ?? -1;
      else if (sortKey === "itemsPerBasket") value = r.itemsPerBasket ?? -1;
      else if (sortKey === "marginPct") value = r.margin.marginPct ?? -Infinity;
      return { row: r, value };
    });
    return withKey.sort((a, b) => b.value - a.value).map((w) => w.row);
  }, [rows, sortKey]);

  const columns: { key: SortKey; label: string }[] = [
    { key: "revenue", label: "Receita" },
    { key: "baskets", label: "Transações" },
    { key: "ticket", label: "Ticket médio" },
    { key: "itemsPerBasket", label: "Itens/compra" },
    { key: "marginPct", label: "Margem %" },
  ];

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Loja</TableHead>
            {columns.map((col) => (
              <TableHead key={col.key} className="tabular text-right">
                <button type="button" onClick={() => onSortKey(col.key)} className="hover:text-foreground">
                  {col.label} {sortKey === col.key && "▼"}
                </button>
              </TableHead>
            ))}
            <TableHead>Categoria líder</TableHead>
            <TableHead>Produto líder</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const lead = leads.get(row.storeId);
            return (
              <TableRow key={row.storeId}>
                <TableCell className="font-medium">{row.storeName}</TableCell>
                <TableCell className="tabular text-right">{currency.format(row.revenueCents / 100)}</TableCell>
                <TableCell className="tabular text-right">{row.basketCount}</TableCell>
                <TableCell className="tabular text-right">{row.ticketAvgCents === null ? "—" : currency.format(row.ticketAvgCents / 100)}</TableCell>
                <TableCell className="tabular text-right">{row.itemsPerBasket === null ? "—" : row.itemsPerBasket.toFixed(2)}</TableCell>
                <TableCell className="tabular text-right">{row.margin.marginPct === null ? "—" : formatPct(row.margin.marginPct)}</TableCell>
                <TableCell className="text-xs">{lead?.category ? categoryLabel(lead.category.category) : "—"}</TableCell>
                <TableCell className="max-w-[160px] truncate text-xs">{lead?.product?.name ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StoreProfile({ props, storeId }: { props: SalesTabProps; storeId: number }) {
  const { okCurrent, networkCurrentByStore, productBySku, costBySku } = props;
  const store = props.currentByStore.find((r) => r.store.id === storeId)?.store;

  const storeStats = useMemo(() => computePeriodStats(okCurrent, costBySku), [okCurrent, costBySku]);

  const networkStats = useMemo(() => {
    const others = networkCurrentByStore.filter((r) => r.store.id !== storeId);
    return computePeriodStats(onlyOk(others.flatMap((r) => r.transactions)), costBySku);
  }, [networkCurrentByStore, storeId, costBySku]);
  const otherStoreCount = networkCurrentByStore.filter((r) => r.store.id !== storeId).length;
  const networkAvgTicket = otherStoreCount > 0 && networkStats.basketCount > 0 ? networkStats.ticketAvgCents : null;

  const uniqueBuyers = useMemo(() => new Set(okCurrent.map((t) => t.buyer_number).filter((v): v is string => Boolean(v))).size, [okCurrent]);
  const hasBuyerNumber = okCurrent.some((t) => t.buyer_number);

  const lead = useMemo(() => leadCategoryAndProduct(okCurrent, productBySku), [okCurrent, productBySku]);

  const dayHour = useMemo(() => {
    const byWeekday = new Map<number, number>();
    const byHour = new Map<number, number>();
    for (const t of okCurrent) {
      if (!t.occurred_at) continue;
      const date = new Date(t.occurred_at);
      if (Number.isNaN(date.getTime())) continue;
      byWeekday.set(date.getDay(), (byWeekday.get(date.getDay()) ?? 0) + t.amount_paid_cents);
      byHour.set(date.getHours(), (byHour.get(date.getHours()) ?? 0) + t.amount_paid_cents);
    }
    const weekdayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    const topWeekday = [...byWeekday.entries()].sort((a, b) => b[1] - a[1])[0];
    const topHour = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      day: topWeekday ? weekdayNames[topWeekday[0]] : null,
      hour: topHour ? `${String(topHour[0]).padStart(2, "0")}h` : null,
    };
  }, [okCurrent]);

  const ticketDeltaPct = networkAvgTicket && storeStats.ticketAvgCents !== null && networkAvgTicket > 0 ? (storeStats.ticketAvgCents - networkAvgTicket) / networkAvgTicket : null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium">Perfil da loja — {store?.name}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SimpleKpiCard label="Receita" value={currency.format(storeStats.revenueCents / 100)} />
        <SimpleKpiCard label="Transações" value={String(storeStats.basketCount)} />
        <SimpleKpiCard
          label="Compradores únicos"
          value={hasBuyerNumber ? String(uniqueBuyers) : "—"}
          hint={hasBuyerNumber ? undefined : "Número comprador não informado neste período"}
        />
        <SimpleKpiCard
          label="Ticket médio"
          value={storeStats.ticketAvgCents === null ? "—" : currency.format(storeStats.ticketAvgCents / 100)}
          hint={ticketDeltaPct !== null ? `${ticketDeltaPct >= 0 ? "+" : ""}${(ticketDeltaPct * 100).toFixed(1)}% vs. rede (${currency.format((networkAvgTicket ?? 0) / 100)})` : undefined}
        />
        <SimpleKpiCard label="Itens por compra" value={storeStats.itemsPerBasket === null ? "—" : storeStats.itemsPerBasket.toFixed(2)} />
        <SimpleKpiCard label="Margem %" value={storeStats.margin.marginPct === null ? "—" : formatPct(storeStats.margin.marginPct)} />
        <SimpleKpiCard label="Categoria líder" value={lead.category ? categoryLabel(lead.category.category) : "—"} hint={lead.category ? formatPct(lead.category.shareOfRevenue) + " das vendas" : undefined} />
        <SimpleKpiCard label="Produto líder" value={lead.product?.name ?? "—"} />
        <SimpleKpiCard label="Dia de maior movimento" value={dayHour.day ?? "—"} />
        <SimpleKpiCard label="Horário de pico" value={dayHour.hour ?? "—"} />
      </div>
    </div>
  );
}

function AffinityList({ props, storeId }: { props: SalesTabProps; storeId: number }) {
  const { okCurrent, networkCurrentByStore, productBySku, costBySku } = props;
  const store = props.currentByStore.find((r) => r.store.id === storeId)?.store;

  const storeRows = useMemo(() => productSalesRows(okCurrent, productBySku, costBySku), [okCurrent, productBySku, costBySku]);
  const networkRows = useMemo(
    () => productSalesRows(onlyOk(networkCurrentByStore.flatMap((r) => r.transactions)), productBySku, costBySku),
    [networkCurrentByStore, productBySku, costBySku],
  );
  const affinity = useMemo(() => productAffinity(storeRows, networkRows).slice(0, 8), [storeRows, networkRows]);

  const mixComparison = useMemo(() => {
    const storeMix = categoryMix(okCurrent, productBySku);
    const networkMix = categoryMix(onlyOk(networkCurrentByStore.flatMap((r) => r.transactions)), productBySku);
    return compareMix(storeMix, networkMix);
  }, [okCurrent, networkCurrentByStore, productBySku]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-1 text-sm font-medium">Produtos característicos da unidade</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Participação nas vendas de {store?.name} comparada à participação na rede — nunca quantidade absoluta, para
          não favorecer lojas maiores.
        </p>
        {affinity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem produtos com afinidade relevante.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {affinity.map((row) => (
              <li key={row.sku} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <span className="truncate">{row.name}</span>
                <span className="tabular shrink-0 font-medium">
                  {Number.isFinite(row.affinity) ? `${row.affinity.toFixed(1)}×` : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium">Mix da loja × mix da rede</h3>
        <p className="mb-3 text-xs text-muted-foreground">Participação de cada categoria nas vendas — vocação de consumo da unidade.</p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead className="tabular text-right">Loja</TableHead>
                <TableHead className="tabular text-right">Rede</TableHead>
                <TableHead className="tabular text-right">Diferença</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mixComparison.map((row) => (
                <TableRow key={row.category}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="tabular text-right">{formatPct(row.storeShare)}</TableCell>
                  <TableCell className="tabular text-right">{formatPct(row.networkShare)}</TableCell>
                  <TableCell className={`tabular text-right ${row.diffPp >= 0 ? "text-success" : "text-destructive"}`}>
                    {row.diffPp >= 0 ? "+" : ""}
                    {(row.diffPp * 100).toFixed(1)} p.p.
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

export function StoresTab(props: SalesTabProps & { storeId: number | null }) {
  const { networkCurrentByStore, productBySku, costBySku, isLoading, error, isEmpty, onRetry, storeId } = props;
  const [sortKey, setSortKey] = useState<SortKey>("revenue");

  const rows = useMemo(() => storePerformanceRows(networkCurrentByStore, costBySku).filter((r) => r.hasTransactionDetail || r.basketCount > 0 || r.revenueCents > 0), [networkCurrentByStore, costBySku]);
  const rowsWithData = useMemo(() => storePerformanceRows(networkCurrentByStore, costBySku).filter((r) => r.hasTransactionDetail && r.basketCount > 0), [networkCurrentByStore, costBySku]);

  return (
    <RequestState isLoading={isLoading} error={error} isEmpty={isEmpty} emptyMessage="Sem detalhe de transação para este período." onRetry={onRetry}>
      <div className="flex flex-col gap-8">
        <div>
          <h3 className="mb-3 text-sm font-medium">Comparativo entre lojas</h3>
          {rowsWithData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma loja com detalhe de transação neste período.</p>
          ) : (
            <ComparisonTable rows={rowsWithData} productBySku={productBySku} networkCurrentByStore={networkCurrentByStore} sortKey={sortKey} onSortKey={setSortKey} />
          )}
          {rows.length > rowsWithData.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              {rows.length - rowsWithData.length} loja(s) sem detalhe de transação neste período não aparecem na tabela.
            </p>
          )}
        </div>

        {storeId !== null && (
          <>
            <StoreProfile props={props} storeId={storeId} />
            <AffinityList props={props} storeId={storeId} />
          </>
        )}
      </div>
    </RequestState>
  );
}
