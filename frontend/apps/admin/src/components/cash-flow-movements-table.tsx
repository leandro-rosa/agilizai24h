"use client";

import { Search } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { ColumnValueFilter } from "@/components/column-value-filter";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { date, money } from "@/lib/format";
import type { BankTransaction } from "@/lib/api/treasury";

const INTERNAL_TRANSFER_CATEGORIES = new Set(["Movimentação entre contas", "Pagamento de fatura"]);

function movementType(t: BankTransaction): "Transferência" | "Entrada" | "Saída" {
  if (INTERNAL_TRANSFER_CATEGORIES.has(t.category)) return "Transferência";
  return t.direction === "inflow" ? "Entrada" : "Saída";
}

/** Uma coluna filtrável — mesmo mecanismo do "Resultado por loja" (AutoFilter de planilha, valor exato, não faixa). */
type FilterColumnKey = "account" | "category" | "type" | "reconciled";

interface ColumnSpec {
  key: FilterColumnKey;
  label: string;
  valueOf: (t: BankTransaction, accountById: Map<number, { name: string }>) => string;
}

const COLUMNS: ColumnSpec[] = [
  { key: "account", label: "Conta", valueOf: (t, accountById) => accountById.get(t.account_id)?.name ?? `Conta ${t.account_id}` },
  { key: "category", label: "Categoria", valueOf: (t) => t.category },
  { key: "type", label: "Tipo", valueOf: (t) => movementType(t) },
  { key: "reconciled", label: "Conciliado", valueOf: (t) => (t.kind === "pending" ? "Pendente" : "Sim") },
];

/**
 * Mesmo raciocínio de `TransactionsTable` (Lançamentos): um período cheio
 * passa de 2 mil lançamentos, então o filtro/busca vive aqui dentro (não
 * na página), pra não obrigar a página a re-renderizar a tabela inteira
 * por causa de outro estado que não afeta `transactions`/`accountById`.
 */
export const CashFlowMovementsTable = memo(function CashFlowMovementsTable({
  transactions,
  accountById,
}: {
  transactions: BankTransaction[];
  accountById: Map<number, { name: string }>;
}) {
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterColumnKey, Set<string>>>>({});

  const columnOptions = useMemo(() => {
    const result = new Map<FilterColumnKey, Map<string, { label: string; count: number }>>();
    for (const col of COLUMNS) {
      const options = new Map<string, { label: string; count: number }>();
      for (const t of transactions) {
        const value = col.valueOf(t, accountById);
        const existing = options.get(value);
        if (existing) existing.count += 1;
        else options.set(value, { label: value, count: 1 });
      }
      result.set(col.key, options);
    }
    return result;
  }, [transactions, accountById]);

  const activeColumnFilterCount = Object.values(columnFilters).filter((set) => set && set.size > 0).length;

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (search && !t.counterparty_raw.toLowerCase().includes(search.toLowerCase())) return false;
      for (const col of COLUMNS) {
        const selected = columnFilters[col.key];
        if (!selected || selected.size === 0) continue;
        if (!selected.has(col.valueOf(t, accountById))) return false;
      }
      return true;
    });
  }, [transactions, accountById, search, columnFilters]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar descrição..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {COLUMNS.map((col) => (
          <ColumnValueFilter
            key={col.key}
            label={col.label}
            options={columnOptions.get(col.key) ?? new Map()}
            selected={columnFilters[col.key] ?? EMPTY_SELECTION}
            onChange={(next) => setColumnFilters((prev) => ({ ...prev, [col.key]: next }))}
          />
        ))}
        {activeColumnFilterCount > 0 && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setColumnFilters({})}>
            Limpar filtros
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {transactions.length === 0 ? "Nenhuma movimentação neste período." : "Nenhuma movimentação bate com a busca/filtro."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="tabular text-right">Valor</TableHead>
              <TableHead>Regime</TableHead>
              <TableHead>Conciliado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => {
              const type = movementType(t);
              return (
                <TableRow key={t.id}>
                  <TableCell className="tabular whitespace-nowrap">{date(t.occurred_on)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{t.counterparty_raw}</span>
                    <div className="text-xs text-muted-foreground">
                      {accountById.get(t.account_id)?.name ?? `Conta ${t.account_id}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.category}</TableCell>
                  <TableCell className={type === "Entrada" ? "text-success" : undefined}>{type}</TableCell>
                  <TableCell className={`tabular text-right ${t.direction === "inflow" ? "text-success" : ""}`}>
                    {t.direction === "inflow" ? "+" : "−"}
                    {money(t.amount_cents)}
                  </TableCell>
                  {/* Sempre Realizado nesta fase — "Previsto" está fora de escopo (ver spec). */}
                  <TableCell>Realizado</TableCell>
                  <TableCell>
                    <StatusBadge tone={t.kind === "pending" ? "attention" : "positive"}>
                      {t.kind === "pending" ? "Pendente" : "Sim"}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
});

/** Referência estável — um `new Set()` novo a cada render quebraria a comparação de `selected.size` sem motivo. */
const EMPTY_SELECTION = new Set<string>();
