"use client";

import { Plus } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetCashFlowQuery, usePutCashFlowMutation } from "@/lib/api/accounting";
import { useHasPermission } from "@/lib/auth/use-permission";
import { currentPeriod, money, moneyCompact, period as fmtPeriod } from "@/lib/format";

const cashFlowSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use "AAAA-MM"'),
  opening: z.string().min(1, "Informe o saldo inicial"),
  receipts: z.string().min(1, "Informe os recebimentos"),
  opex: z.string().min(1, "Informe o OPEX"),
  loans: z.string().min(1, "Informe os empréstimos"),
  capex: z.string().min(1, "Informe o CAPEX"),
});

type CashFlowForm = z.infer<typeof cashFlowSchema>;

const FIELDS: FieldSpec<CashFlowForm>[] = [
  { name: "period", label: "Competência", kind: "text", placeholder: "2026-07" },
  { name: "opening", label: "Saldo inicial (R$)", kind: "number" },
  { name: "receipts", label: "(+) Receitas recebidas (R$)", kind: "number" },
  { name: "opex", label: "(−) OPEX (R$)", kind: "number" },
  { name: "loans", label: "(−) Empréstimos (R$)", kind: "number" },
  {
    name: "capex",
    label: "(−) CAPEX (R$)",
    kind: "number",
    hint: "O saldo final é sempre derivado — não é informado.",
  },
];

const chartConfig: ChartConfig = {
  closing_balance_cents: { label: "Saldo acumulado", color: "var(--chart-1)" },
};

export default function CashFlowPage() {
  const { data, isLoading, error, refetch } = useGetCashFlowQuery();
  const [putCashFlow] = usePutCashFlowMutation();
  const canWrite = useHasPermission("accounting:write");

  const series = (data ?? []).map((row) => ({
    period: fmtPeriod(row.period),
    closing_balance_cents: row.closing_balance_cents / 100,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fluxo de caixa"
        description="Recebimentos, OPEX, empréstimos e CAPEX, mês a mês."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Lançar período"
              description="Relançar o mesmo mês substitui os valores; o saldo final é derivado."
              trigger={
                <Button>
                  <Plus /> Lançar período
                </Button>
              }
              schema={cashFlowSchema}
              fields={FIELDS}
              defaultValues={{ period: currentPeriod() } as CashFlowForm}
              onSubmit={(values) =>
                putCashFlow({
                  period: values.period,
                  opening_balance_cents: toCents(values.opening),
                  receipts_cents: toCents(values.receipts),
                  opex_cents: toCents(values.opex),
                  loan_payments_cents: toCents(values.loans),
                  capex_cents: toCents(values.capex),
                }).unwrap()
              }
            />
          ) : null
        }
      />

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(data ?? []).length === 0}
        emptyMessage="Nenhum período lançado."
        onRetry={refetch}
      >
        {series.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Saldo acumulado</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-64 w-full">
                <LineChart data={series} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)" }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)" }}
                    tickFormatter={(value: number) => moneyCompact(value * 100)}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="closing_balance_cents"
                    stroke="var(--color-closing_balance_cents)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Competência</TableHead>
              <TableHead className="tabular text-right">Saldo inicial</TableHead>
              <TableHead className="tabular text-right">(+) Recebimentos</TableHead>
              <TableHead className="tabular text-right">(−) OPEX</TableHead>
              <TableHead className="tabular text-right">(−) Empréstimos</TableHead>
              <TableHead className="tabular text-right">(−) CAPEX</TableHead>
              <TableHead className="tabular text-right">Saldo final</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((row) => (
              <TableRow key={row.period}>
                <TableCell className="font-medium">{fmtPeriod(row.period)}</TableCell>
                <TableCell className="tabular text-right">{money(row.opening_balance_cents)}</TableCell>
                <TableCell className="tabular text-right text-success">{money(row.receipts_cents)}</TableCell>
                <TableCell className="tabular text-right">{money(row.opex_cents)}</TableCell>
                <TableCell className="tabular text-right">{money(row.loan_payments_cents)}</TableCell>
                <TableCell className="tabular text-right">{money(row.capex_cents)}</TableCell>
                <TableCell
                  className={`tabular text-right font-semibold ${row.closing_balance_cents < 0 ? "text-destructive" : ""}`}
                >
                  {money(row.closing_balance_cents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </RequestState>
    </div>
  );
}
