"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { period as fmtPeriod } from "@/lib/format";
import { IMPORT_STATUS_LABELS, TREASURY_SOURCE_LABELS, useGetPendingImportsQuery } from "@/lib/api/treasury";
import { useHasPermission } from "@/lib/auth/use-permission";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function TreasuryImportsPage() {
  const router = useRouter();
  const canWrite = useHasPermission("treasury:write");
  const { data: imports, isLoading, error, refetch } = useGetPendingImportsQuery();

  const sorted = [...(imports ?? [])].sort((a, b) => b.period.localeCompare(a.period) || b.id - a.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Importar extratos"
        description="Upload mensal do extrato bancário e da fatura de cartão — conferência antes de contar no dashboard."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/treasury/imports/upload">
                <Plus /> Nova importação
              </Link>
            </Button>
          ) : null
        }
      />

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={sorted.length === 0}
        emptyMessage="Nenhuma importação enviada ainda."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Competência</TableHead>
              <TableHead>Fonte</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="tabular text-right">Linhas</TableHead>
              <TableHead className="tabular text-right">Rejeitadas</TableHead>
              <TableHead>Enviado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((imp) => (
              <TableRow key={imp.id} className="cursor-pointer" onClick={() => router.push(`/treasury/imports/${imp.period}`)}>
                <TableCell className="font-medium">{fmtPeriod(imp.period)}</TableCell>
                <TableCell>{TREASURY_SOURCE_LABELS[imp.source]}</TableCell>
                <TableCell>
                  <StatusBadge tone={imp.status === "confirmed" ? "positive" : imp.status === "rejected" ? "critical" : "attention"}>
                    {IMPORT_STATUS_LABELS[imp.status]}
                  </StatusBadge>
                </TableCell>
                <TableCell className="tabular text-right">{imp.line_count}</TableCell>
                <TableCell className="tabular text-right">{imp.rejected_line_count}</TableCell>
                <TableCell>{dateTimeFormatter.format(new Date(imp.created_at))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </RequestState>
    </div>
  );
}
