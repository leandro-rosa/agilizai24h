"use client";

import { Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ORIGIN_LABELS,
  SECTION_LABELS,
  useComputePnlMutation,
  useGetPnlQuery,
  type AccountNode,
} from "@/lib/api/accounting";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useHasPermission } from "@/lib/auth/use-permission";
import { bps, currentPeriod, money, period as fmtPeriod } from "@/lib/format";

const NETWORK = "network";

export default function PnlPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [scope, setScope] = useState<string>(NETWORK);

  const storeId = scope === NETWORK ? undefined : Number(scope);
  const { data, isLoading, error, refetch } = useGetPnlQuery({ period, storeId });
  const { data: stores } = useGetStoresQuery();
  const [compute, { isLoading: computing }] = useComputePnlMutation();
  const canWrite = useHasPermission("accounting:write");

  const activeStores = (stores ?? []).filter((s) => s.status === "active").length;

  async function close() {
    const result = await compute({ period, storeId, storeCount: activeStores, close: true })
      .unwrap()
      .catch(() => null);
    if (result) toast.success(`DRE de ${fmtPeriod(period)} fechado.`);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="DRE"
        description="Receita, deduções, CMV e despesas até a margem operacional."
        actions={
          canWrite ? (
            <Button variant="outline" onClick={close} disabled={computing}>
              {data?.status === "closed" ? <Lock /> : <RefreshCw />}
              {computing ? "Apurando..." : data?.status === "closed" ? "Reapurar e fechar" : "Fechar o mês"}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lastPeriods(18).map((p) => (
              <SelectItem key={p} value={p}>
                {fmtPeriod(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NETWORK}>Rede (todas as lojas)</SelectItem>
            {(stores ?? []).map((store) => (
              <SelectItem key={store.id} value={String(store.id)}>
                {store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && (
          <StatusBadge tone={data.status === "closed" ? "positive" : "attention"} className="self-center">
            {data.status === "closed" ? "Fechado" : "Aberto"}
          </StatusBadge>
        )}
      </div>

      <RequestState isLoading={isLoading} error={error} onRetry={refetch} loadingRows={10}>
        {data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Receita líquida" value={money(data.totals.net_revenue_cents)} />
              <Kpi label="Margem de contribuição" value={money(data.totals.contribution_margin_cents)} />
              <Kpi
                label="EBITDA"
                value={money(data.totals.ebitda_cents)}
                tone={data.totals.ebitda_cents < 0 ? "critical" : "positive"}
              />
              <Kpi
                label="Margem operacional"
                value={money(data.totals.operating_profit_cents)}
                tone={data.totals.operating_profit_cents < 0 ? "critical" : "positive"}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Kpi
                label="Ponto de equilíbrio"
                /*
                 * -1 do serviço quer dizer INDEFINIDO, não zero: com margem de
                 * contribuição não-positiva nenhum volume de venda cobre o
                 * fixo. Mostrar "R$ 0,00" diria que já está no equilíbrio.
                 */
                value={data.totals.break_even_cents < 0 ? "—" : money(data.totals.break_even_cents)}
                hint={
                  data.totals.break_even_cents < 0
                    ? "Indefinido: a margem de contribuição não é positiva."
                    : undefined
                }
              />
              <Kpi
                label="Margem de segurança"
                value={bps(data.totals.safety_margin_bps)}
                tone={data.totals.safety_margin_bps < 0 ? "critical" : undefined}
                hint={
                  data.totals.safety_margin_bps < 0 ? "A receita está abaixo do ponto de equilíbrio." : undefined
                }
              />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="tabular text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sections.map((section) => (
                  <SectionRows key={section.section} section={section} />
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </RequestState>
    </div>
  );
}

function SectionRows({
  section,
}: {
  section: { section: string; amount_cents: number; accounts: AccountNode[] };
}) {
  return (
    <>
      <TableRow className="bg-muted/50">
        <TableCell colSpan={2} className="font-semibold">
          {SECTION_LABELS[section.section] ?? section.section}
        </TableCell>
        <TableCell className="tabular text-right font-semibold">{money(section.amount_cents)}</TableCell>
      </TableRow>
      {section.accounts.map((account) => (
        <AccountRow key={account.id} node={account} depth={0} />
      ))}
    </>
  );
}

function AccountRow({ node, depth }: { node: AccountNode; depth: number }) {
  return (
    <>
      <TableRow>
        <TableCell style={{ paddingLeft: `${1 + depth * 1.5}rem` }}>
          <span className="text-sm">{node.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{node.code}</span>
        </TableCell>
        <TableCell>
          {node.origin ? (
            // Rotular a origem é o que distingue FATO (veio de um serviço) de
            // PREMISSA (alguém digitou) — regra da raiz do repo.
            <StatusBadge tone={node.origin === "manual" ? "attention" : "neutral"}>
              {ORIGIN_LABELS[node.origin] ?? node.origin}
            </StatusBadge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="tabular text-right">
          {node.amount_cents === 0 ? <span className="text-muted-foreground">—</span> : money(node.amount_cents)}
        </TableCell>
      </TableRow>
      {node.children.map((child) => (
        <AccountRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function Kpi({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "positive" | "critical";
  hint?: string;
}) {
  const color = tone === "positive" ? "text-success" : tone === "critical" ? "text-destructive" : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`tabular text-2xl font-semibold ${color}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function lastPeriods(n: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < n; i += 1) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return out;
}
