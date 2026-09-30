"use client";

import { useMemo, useState } from "react";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query/react";

import { MonthRangePicker } from "@/components/month-range-picker";
import { RequestState } from "@/components/request-state";
import { useGetBalanceAuditQuery, useGetIngestionGapsQuery } from "@/lib/api/balance-audit";
import { useHasPermission } from "@/lib/auth/use-permission";
import { addMonths, lastCompleteMonth, type PeriodRange } from "@/lib/period-range";
import { BalanceQualityView } from "./balance-quality-view";

const READ_PERMISSION = "inventory:read";

/**
 * "Qualidade do saldo": read-only, network-wide. It does not depend on the
 * store picked on the other tabs — the audit is about the whole network's data.
 *
 * Without the permission, nothing is requested: the forbidden state is shown
 * from the session's own permissions, and only a real 403 from the gateway
 * (a permission revoked mid-session) reaches `RequestState` as an error.
 */
export function BalanceQualityTab({ storeName }: { storeName: (storeId: number) => string }) {
  const allowed = useHasPermission(READ_PERMISSION);
  const [range, setRange] = useState<PeriodRange>(() => {
    const end = lastCompleteMonth();
    return { start: addMonths(end, -5), end };
  });
  const args = useMemo(() => ({ from: range.start, to: range.end }), [range]);

  const audit = useGetBalanceAuditQuery(args, { skip: !allowed });
  const gaps = useGetIngestionGapsQuery(args, { skip: !allowed });

  const forbidden: FetchBaseQueryError | undefined = !allowed ? { status: 403, data: null } : undefined;
  const isEmpty = allowed && audit.isSuccess && audit.data.covered.visits === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthRangePicker value={range} onChange={setRange} />
        <p className="text-sm text-muted-foreground">Toda a rede. Só leitura: esta tela descreve os dados e não altera nada.</p>
      </div>

      <RequestState
        isLoading={allowed && audit.isLoading}
        error={forbidden ?? audit.error}
        isEmpty={isEmpty}
        emptyMessage="Ainda não há dados de visitas de abastecimento neste período. Importe (ou reimporte) os relatórios de abastecimento para habilitar esta análise."
        onRetry={audit.refetch}
        loadingRows={6}
      >
        {audit.data && <BalanceQualityView audit={audit.data} gaps={gaps.data} gapsError={gaps.isError} storeName={storeName} />}
      </RequestState>
    </div>
  );
}
