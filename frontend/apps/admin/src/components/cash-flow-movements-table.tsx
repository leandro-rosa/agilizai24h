"use client";

import { memo } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { date, money } from "@/lib/format";
import type { BankTransaction } from "@/lib/api/treasury";

const INTERNAL_TRANSFER_CATEGORIES = new Set(["Movimentação entre contas", "Pagamento de fatura"]);

function movementType(t: BankTransaction): "Transferência" | "Entrada" | "Saída" {
  if (INTERNAL_TRANSFER_CATEGORIES.has(t.category)) return "Transferência";
  return t.direction === "inflow" ? "Entrada" : "Saída";
}

/**
 * Mesmo raciocínio de `TransactionsTable` (Lançamentos): `memo` porque um
 * período cheio passa de 2 mil lançamentos, e esta tabela não deve
 * re-renderizar quando outro estado da página (filtro de conta, seletor de
 * período) muda sem afetar `transactions`/`accountById`.
 */
export const CashFlowMovementsTable = memo(function CashFlowMovementsTable({
  transactions,
  accountById,
}: {
  transactions: BankTransaction[];
  accountById: Map<number, { name: string }>;
}) {
  if (transactions.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma movimentação neste período.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Descrição</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead className="tabular text-right">Valor</TableHead>
          <TableHead>Regime</TableHead>
          <TableHead>Conciliado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((t) => {
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
  );
});
