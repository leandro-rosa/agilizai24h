"use client";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { useGetPendingPaymentsQuery } from "@/lib/api/purchases";
import { formatCents, formatDate } from "@/lib/purchases/money";

export default function PendingPaymentsPage() {
  const query = useGetPendingPaymentsQuery();
  const groups = query.data?.groups ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader title="A pagar" description="Itens pagos ainda em aberto, por dia de vencimento. Quem paga ao receber aparece em “Aguardando recebimento”, sem data. O painel só mostra; não paga." />
      <RequestState isLoading={query.isLoading} error={query.error} onRetry={query.refetch} isEmpty={groups.length === 0} emptyMessage="Nada a pagar no momento.">
        <p className="tabular text-lg">Total em aberto: {formatCents(query.data?.total_cents ?? 0)}</p>
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <section key={group.due_on ?? "none"} className="rounded-lg border p-3">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                {group.due_on ? `Vence em ${formatDate(group.due_on)}` : "Aguardando recebimento (paga ao receber)"}
                {group.overdue && <StatusBadge tone="critical">Vencido</StatusBadge>}
                <span className="tabular ml-auto">{formatCents(group.total_cents)}</span>
              </h2>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {group.items.map((item) => (
                  <li key={item.item_id} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {item.supplier_name ?? "Fornecedor"} · {item.description ?? item.sku} · {item.quantity} un.
                    </span>
                    <span className="tabular">{formatCents(item.total_cents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </RequestState>
    </div>
  );
}
