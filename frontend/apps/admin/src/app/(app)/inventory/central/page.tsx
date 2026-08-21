"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useCreateLotMutation,
  useDeleteLotMutation,
  useGetCentralStockQuery,
  useGetCentralStockSummaryQuery,
} from "@/lib/api/inventory";
import { useHasPermission } from "@/lib/auth/use-permission";
import { count, date, money } from "@/lib/format";

const lotSchema = z.object({
  sku: z.string().min(1, "Informe o SKU"),
  ean: z.string().optional(),
  quantity: z.string().min(1, "Informe a quantidade"),
  received_on: z.string().min(1, "Informe o recebimento"),
  expires_on: z.string().optional(),
  unit_cost: z.string().optional(),
  note: z.string().optional(),
});

type LotForm = z.infer<typeof lotSchema>;

const FIELDS: FieldSpec<LotForm>[] = [
  { name: "sku", label: "SKU", kind: "text" },
  { name: "ean", label: "EAN", kind: "text" },
  { name: "quantity", label: "Quantidade", kind: "number" },
  { name: "received_on", label: "Recebimento", kind: "date" },
  { name: "expires_on", label: "Validade", kind: "date", hint: "Vazio para item sem validade." },
  { name: "unit_cost", label: "Custo unitário (R$)", kind: "number" },
  { name: "note", label: "Observação", kind: "text" },
];

/** Vencido grita, vencendo em 30 dias avisa, o resto é neutro. */
function expiryTone(expiresOn: string | null): { tone: StatusTone; label: string } | null {
  if (!expiresOn) return null;

  const today = new Date().toISOString().slice(0, 10);
  const due = expiresOn.slice(0, 10);
  if (due < today) return { tone: "critical", label: "Vencido" };

  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  if (due <= in30.toISOString().slice(0, 10)) return { tone: "attention", label: "Vence em 30d" };

  return null;
}

export default function CentralStockPage() {
  const [window, setWindow] = useState<string>("all");
  const filter = window === "all" ? undefined : { expiring_within_days: Number(window) };

  const { data: lots, isLoading, error, refetch } = useGetCentralStockQuery(filter);
  const { data: summary } = useGetCentralStockSummaryQuery();
  const [createLot] = useCreateLotMutation();
  const [deleteLot] = useDeleteLotMutation();
  const canWrite = useHasPermission("inventory:write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Estoque central"
        description="O que está parado no CD, por lote, e o que está prestes a virar perda."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Novo lote"
              description="Por lote, não por SKU: duas entregas do mesmo produto vencem em datas diferentes."
              trigger={
                <Button>
                  <Plus /> Novo lote
                </Button>
              }
              schema={lotSchema}
              fields={FIELDS}
              defaultValues={{ received_on: new Date().toISOString().slice(0, 10) } as LotForm}
              onSubmit={(values) =>
                createLot({
                  sku: values.sku,
                  ean: values.ean || undefined,
                  quantity: Number(values.quantity),
                  received_on: values.received_on,
                  expires_on: values.expires_on || undefined,
                  unit_cost_cents: values.unit_cost ? toCents(values.unit_cost) : undefined,
                  note: values.note || undefined,
                }).unwrap()
              }
            />
          ) : null
        }
      />

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Unidades no CD</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold">{count(summary.total_quantity)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{count(summary.lot_count)} lote(s)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Vencido</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`tabular text-2xl font-semibold ${summary.expired_quantity > 0 ? "text-destructive" : ""}`}>
                {count(summary.expired_quantity)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Vence em 30 dias</CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`tabular text-2xl font-semibold ${summary.expiring_30d_quantity > 0 ? "text-warning" : ""}`}
              >
                {count(summary.expiring_30d_quantity)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Valor parado</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold">{money(summary.valued_amount_cents)}</p>
              {/* A cifra só conta lote com custo informado — dizer sobre quantos
                  é o que impede ela de passar por completa. */}
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {summary.valued_lot_count < summary.lot_count && <AlertTriangle className="size-3 text-warning" />}
                sobre {count(summary.valued_lot_count)} de {count(summary.lot_count)} lote(s)
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Select value={window} onValueChange={setWindow}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os lotes</SelectItem>
          <SelectItem value="30">Vence em até 30 dias (e vencidos)</SelectItem>
          <SelectItem value="60">Vence em até 60 dias (e vencidos)</SelectItem>
          <SelectItem value="90">Vence em até 90 dias (e vencidos)</SelectItem>
        </SelectContent>
      </Select>

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(lots ?? []).length === 0}
        emptyMessage="Nenhum lote no estoque central."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>EAN</TableHead>
              <TableHead className="tabular text-right">Qtd.</TableHead>
              <TableHead>Recebimento</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead className="tabular text-right">Custo unit.</TableHead>
              {canWrite && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(lots ?? []).map((lot) => {
              const expiry = expiryTone(lot.expires_on);
              return (
                <TableRow key={lot.id}>
                  <TableCell className="tabular font-medium">{lot.sku}</TableCell>
                  <TableCell className="tabular">{lot.ean ?? "—"}</TableCell>
                  <TableCell className="tabular text-right">{count(lot.quantity)}</TableCell>
                  <TableCell className="tabular">{date(lot.received_on)}</TableCell>
                  <TableCell className="tabular">
                    {date(lot.expires_on)}
                    {expiry && (
                      <StatusBadge tone={expiry.tone} className="ml-2">
                        {expiry.label}
                      </StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{money(lot.unit_cost_cents)}</TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" title="Excluir" onClick={() => deleteLot(lot.id)}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </RequestState>
    </div>
  );
}
