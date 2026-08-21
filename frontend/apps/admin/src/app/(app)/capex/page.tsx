"use client";

import { Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, fromCents, toCents, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  INVESTMENT_KIND_LABELS,
  INVESTMENT_KINDS,
  ITEM_CATEGORIES,
  ITEM_CATEGORY_LABELS,
  useCreateItemMutation,
  useGetInvestmentQuery,
  useGetPaybackQuery,
  usePutInvestmentMutation,
  type PaybackRow,
} from "@/lib/api/capex";
import { useGetStoresQuery } from "@/lib/api/stores";
import { useHasPermission } from "@/lib/auth/use-permission";
import { count, date, money } from "@/lib/format";

const itemSchema = z.object({
  store_id: z.string().optional(),
  category: z.enum(ITEM_CATEGORIES),
  description: z.string().min(1, "Informe a descrição"),
  quantity: z.string().optional(),
  cash_amount: z.string().min(1, "Informe o valor à vista"),
  financed_amount: z.string().optional(),
  installments: z.string().optional(),
  purchased_on: z.string().min(1, "Informe a data"),
  funding_source: z.string().min(1, "Informe a origem do dinheiro"),
  investment_kind: z.enum(INVESTMENT_KINDS),
});

type ItemForm = z.infer<typeof itemSchema>;

const referenceSchema = z.object({
  monthly_revenue: z.string().optional(),
  monthly_profit: z.string().optional(),
});

type ReferenceForm = z.infer<typeof referenceSchema>;

export default function CapexPage() {
  const { data: rows, isLoading, error, refetch } = useGetPaybackQuery();
  const { data: stores } = useGetStoresQuery();
  const [createItem] = useCreateItemMutation();
  const [putInvestment] = usePutInvestmentMutation();
  const canWrite = useHasPermission("capex:write");

  const [itemsOf, setItemsOf] = useState<number | null>(null);
  const [referenceOf, setReferenceOf] = useState<PaybackRow | null>(null);

  const storeName = (id: number) => stores?.find((s) => s.id === id)?.name ?? `Loja #${id}`;

  const itemFields: FieldSpec<ItemForm>[] = [
    {
      name: "store_id",
      label: "Loja",
      kind: "select",
      options: (stores ?? []).map((s) => ({ value: String(s.id), label: s.name })),
      hint: "Vazio = investimento não atribuível a uma loja.",
    },
    {
      name: "category",
      label: "Categoria",
      kind: "select",
      options: ITEM_CATEGORIES.map((c) => ({ value: c, label: ITEM_CATEGORY_LABELS[c] })),
    },
    { name: "description", label: "Descrição", kind: "text", placeholder: "Refrigerador vertical 4 portas" },
    { name: "quantity", label: "Quantidade", kind: "number", placeholder: "1" },
    { name: "cash_amount", label: "Valor à vista (R$)", kind: "number" },
    {
      name: "financed_amount",
      label: "Total parcelado (R$)",
      kind: "number",
      hint: "Se houver parcelamento, é este valor que conta — a diferença é o custo do crédito.",
    },
    { name: "installments", label: "Parcelas", kind: "number" },
    { name: "purchased_on", label: "Compra", kind: "date" },
    { name: "funding_source", label: "Origem do dinheiro", kind: "text", placeholder: "Josias" },
    {
      name: "investment_kind",
      label: "Tipo",
      kind: "select",
      options: INVESTMENT_KINDS.map((k) => ({ value: k, label: INVESTMENT_KIND_LABELS[k] })),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="CAPEX por loja"
        description="Quanto cada loja custou para abrir e em quantos meses se paga."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Novo item de investimento"
              trigger={
                <Button>
                  <Plus /> Novo item
                </Button>
              }
              schema={itemSchema}
              fields={itemFields}
              defaultValues={
                {
                  category: "fridge",
                  investment_kind: "fixed",
                  quantity: "1",
                  purchased_on: new Date().toISOString().slice(0, 10),
                } as ItemForm
              }
              onSubmit={(values) =>
                createItem({
                  store_id: values.store_id ? Number(values.store_id) : undefined,
                  category: values.category,
                  description: values.description,
                  quantity: Number(values.quantity || 1),
                  cash_amount_cents: toCents(values.cash_amount),
                  financed_amount_cents: toCents(values.financed_amount ?? "0"),
                  installments: Number(values.installments || 1),
                  purchased_on: values.purchased_on,
                  funding_source: values.funding_source,
                  investment_kind: values.investment_kind,
                }).unwrap()
              }
            />
          ) : null
        }
      />

      <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
        <strong>Payback é métrica derivada</strong> — divide o investido pelo lucro mensal de referência, que hoje é
        digitado aqui e não lido do financeiro. Trate como estimativa, não como fato.
      </p>

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(rows ?? []).length === 0}
        emptyMessage="Nenhum investimento registrado."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead className="tabular text-right">Investido</TableHead>
              <TableHead className="tabular text-right">Faturamento/mês</TableHead>
              <TableHead className="tabular text-right">Lucro/mês</TableHead>
              <TableHead className="tabular text-right">Payback</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((row) => (
              <TableRow key={row.store_id}>
                <TableCell className="font-medium">{storeName(row.store_id)}</TableCell>
                <TableCell className="tabular text-right">{money(row.total_invested_cents)}</TableCell>
                <TableCell className="tabular text-right">{money(row.monthly_revenue_cents)}</TableCell>
                <TableCell
                  className={`tabular text-right ${row.monthly_profit_cents <= 0 ? "text-destructive" : ""}`}
                >
                  {money(row.monthly_profit_cents)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {row.payback_months === null ? (
                    // null é INDEFINIDO, não zero: nenhum número de meses paga
                    // uma loja sem lucro.
                    <StatusBadge tone="critical">Indefinido</StatusBadge>
                  ) : (
                    `${row.payback_months.toFixed(1)} meses`
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Itens" onClick={() => setItemsOf(row.store_id)}>
                    <Plus />
                  </Button>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Faturamento e lucro de referência"
                      onClick={() => setReferenceOf(row)}
                    >
                      <Settings2 />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </RequestState>

      {referenceOf && (
        <ResourceFormDialog
          key={referenceOf.store_id}
          title={`Referência de ${storeName(referenceOf.store_id)}`}
          description="São premissas — o payback herda esse rótulo enquanto não vierem do financeiro."
          schema={referenceSchema}
          fields={[
            { name: "monthly_revenue", label: "Faturamento mensal (R$)", kind: "number" },
            { name: "monthly_profit", label: "Lucro mensal (R$)", kind: "number" },
          ]}
          defaultValues={
            {
              monthly_revenue: fromCents(referenceOf.monthly_revenue_cents),
              monthly_profit: fromCents(referenceOf.monthly_profit_cents),
            } as ReferenceForm
          }
          open
          onOpenChange={(open) => !open && setReferenceOf(null)}
          onSubmit={(values) =>
            putInvestment({
              store_id: referenceOf.store_id,
              monthly_revenue_cents: toCents(values.monthly_revenue ?? "0"),
              monthly_profit_cents: toCents(values.monthly_profit ?? "0"),
            }).unwrap()
          }
        />
      )}

      <ItemsSheet storeId={itemsOf} storeName={storeName} onClose={() => setItemsOf(null)} />
    </div>
  );
}

function ItemsSheet({
  storeId,
  storeName,
  onClose,
}: {
  storeId: number | null;
  storeName: (id: number) => string;
  onClose: () => void;
}) {
  const { data, isLoading, error, refetch } = useGetInvestmentQuery(storeId as number, { skip: storeId === null });

  return (
    <Sheet open={storeId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{storeId !== null ? storeName(storeId) : ""}</SheetTitle>
          <SheetDescription>
            Total investido: <span className="tabular">{money(data?.total_invested_cents)}</span> em{" "}
            {count(data?.items.length)} item(ns).
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4">
          <RequestState
            isLoading={isLoading}
            error={error}
            isEmpty={(data?.items.length ?? 0) === 0}
            emptyMessage="Nenhum item registrado."
            onRetry={refetch}
            loadingRows={4}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="tabular text-right">Qtd.</TableHead>
                  <TableHead className="tabular text-right">Custo</TableHead>
                  <TableHead>Compra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {ITEM_CATEGORY_LABELS[item.category] ?? item.category} · {item.funding_source}
                      </p>
                    </TableCell>
                    <TableCell className="tabular text-right">{item.quantity}</TableCell>
                    <TableCell className="tabular text-right">
                      {money(item.financed_amount_cents > 0 ? item.financed_amount_cents : item.cash_amount_cents)}
                      {item.financed_amount_cents > 0 && (
                        <span className="block text-xs text-muted-foreground">{item.installments}x</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular">{date(item.purchased_on)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </RequestState>
        </div>
      </SheetContent>
    </Sheet>
  );
}
