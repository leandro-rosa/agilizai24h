"use client";

import { Building2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  SEGMENT_LABELS,
  SEGMENTS,
  useCreateClientMutation,
  useCreateSiteMutation,
  useGetClientQuery,
  useGetClientsQuery,
  useUpdateClientMutation,
  type Client,
} from "@/lib/api/billing";
import { useHasPermission } from "@/lib/auth/use-permission";
import { count } from "@/lib/format";

const clientSchema = z.object({
  name: z.string().min(1, "Informe o nome"),
  legal_name: z.string().min(1, "Informe a razão social"),
  tax_id: z.string().min(1, "Informe o CNPJ"),
  segment: z.enum(SEGMENTS),
  contact_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

type ClientForm = z.infer<typeof clientSchema>;

const CLIENT_FIELDS: FieldSpec<ClientForm>[] = [
  { name: "name", label: "Nome", kind: "text", placeholder: "Ascenty" },
  { name: "legal_name", label: "Razão social", kind: "text" },
  { name: "tax_id", label: "CNPJ da matriz", kind: "text", placeholder: "13.743.550/0001-42" },
  {
    name: "segment",
    label: "Segmento",
    kind: "select",
    options: SEGMENTS.map((s) => ({ value: s, label: SEGMENT_LABELS[s] })),
  },
  { name: "contact_name", label: "Contato", kind: "text" },
  { name: "email", label: "E-mail", kind: "email" },
  { name: "phone", label: "Telefone", kind: "text" },
];

const siteSchema = z.object({
  code: z.string().min(1, "Informe o código"),
  tax_id: z.string().optional(),
  address: z.string().min(1, "Informe o endereço"),
  city: z.string().min(1, "Informe a cidade"),
  employees: z.string().optional(),
  weighted_daily_traffic: z.string().optional(),
  store_id: z.string().optional(),
});

type SiteForm = z.infer<typeof siteSchema>;

const SITE_FIELDS: FieldSpec<SiteForm>[] = [
  { name: "code", label: "Código", kind: "text", placeholder: "HTL05", hint: "Casa com o código do site na loja." },
  { name: "tax_id", label: "CNPJ da unidade", kind: "text" },
  { name: "address", label: "Endereço", kind: "text" },
  { name: "city", label: "Cidade", kind: "text" },
  { name: "employees", label: "Funcionários", kind: "number" },
  {
    name: "weighted_daily_traffic",
    label: "Total ponderado/dia",
    kind: "number",
    hint: "O denominador do ticket médio — visitante pesa menos que funcionário.",
  },
  { name: "store_id", label: "Loja instalada (id)", kind: "number" },
];

export default function ClientsPage() {
  const { data: clients, isLoading, error, refetch } = useGetClientsQuery();
  const [createClient] = useCreateClientMutation();
  const [updateClient] = useUpdateClientMutation();
  const canWrite = useHasPermission("billing:write");

  const [editing, setEditing] = useState<Client | null>(null);
  const [sitesOf, setSitesOf] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clientes"
        description="Quem hospeda as lojas — e cada unidade, com seu CNPJ próprio."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Novo cliente"
              trigger={
                <Button>
                  <Plus /> Novo cliente
                </Button>
              }
              schema={clientSchema}
              fields={CLIENT_FIELDS}
              defaultValues={{ segment: "company" } as ClientForm}
              onSubmit={(values) => createClient(values).unwrap()}
            />
          ) : null
        }
      />

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(clients ?? []).length === 0}
        emptyMessage="Nenhum cliente cadastrado."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Segmento</TableHead>
              <TableHead className="tabular text-right">Unidades</TableHead>
              <TableHead className="tabular text-right">Contratos</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(clients ?? []).map((client) => (
              <TableRow key={client.id}>
                <TableCell className="font-medium">{client.name}</TableCell>
                <TableCell className="tabular">{client.tax_id}</TableCell>
                <TableCell>{SEGMENT_LABELS[client.segment] ?? client.segment}</TableCell>
                <TableCell className="tabular text-right">{count(client._count?.sites)}</TableCell>
                <TableCell className="tabular text-right">{count(client._count?.contracts)}</TableCell>
                <TableCell>
                  <StatusBadge tone={client.status === "active" ? "positive" : "neutral"}>
                    {client.status === "active" ? "Ativo" : "Inativo"}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Unidades" onClick={() => setSitesOf(client.id)}>
                    <Building2 />
                  </Button>
                  {canWrite && (
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => setEditing(client)}>
                      <Pencil />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </RequestState>

      {editing && (
        <ResourceFormDialog
          key={editing.id}
          title={`Editar ${editing.name}`}
          schema={clientSchema}
          fields={CLIENT_FIELDS}
          defaultValues={
            {
              name: editing.name,
              legal_name: editing.legal_name,
              tax_id: editing.tax_id,
              segment: editing.segment as ClientForm["segment"],
              contact_name: editing.contact_name ?? "",
              email: editing.email ?? "",
              phone: editing.phone ?? "",
            } as ClientForm
          }
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(values) => updateClient({ id: editing.id, ...values }).unwrap()}
        />
      )}

      <SitesSheet clientId={sitesOf} onClose={() => setSitesOf(null)} canWrite={canWrite} />
    </div>
  );
}

function SitesSheet({
  clientId,
  onClose,
  canWrite,
}: {
  clientId: number | null;
  onClose: () => void;
  canWrite: boolean;
}) {
  const { data, isLoading, error, refetch } = useGetClientQuery(clientId as number, { skip: clientId === null });
  const [createSite] = useCreateSiteMutation();

  return (
    <Sheet open={clientId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Unidades de {data?.name ?? "…"}</SheetTitle>
          <SheetDescription>
            Cada unidade tem CNPJ próprio e é onde a loja é instalada — a Ascenty sozinha tem 20 CNPJs distintos.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {canWrite && clientId !== null && (
            <ResourceFormDialog
              title="Nova unidade"
              trigger={
                <Button variant="outline" className="self-start">
                  <Plus /> Nova unidade
                </Button>
              }
              schema={siteSchema}
              fields={SITE_FIELDS}
              defaultValues={{} as SiteForm}
              onSubmit={(values) =>
                createSite({
                  id: clientId,
                  code: values.code,
                  tax_id: values.tax_id || undefined,
                  address: values.address,
                  city: values.city,
                  employees: values.employees ? Number(values.employees) : undefined,
                  weighted_daily_traffic: values.weighted_daily_traffic
                    ? Number(values.weighted_daily_traffic)
                    : undefined,
                  store_id: values.store_id ? Number(values.store_id) : undefined,
                }).unwrap()
              }
            />
          )}

          <RequestState
            isLoading={isLoading}
            error={error}
            isEmpty={(data?.sites.length ?? 0) === 0}
            emptyMessage="Nenhuma unidade cadastrada."
            onRetry={refetch}
            loadingRows={3}
          >
            <ul className="flex flex-col gap-2">
              {data?.sites.map((site) => (
                <li key={site.id} className="rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{site.code}</p>
                    {site.store_id !== null && <StatusBadge tone="positive">Loja #{site.store_id}</StatusBadge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {site.address} · {site.city}
                  </p>
                  {site.weighted_daily_traffic !== null && (
                    <p className="tabular mt-1 text-xs text-muted-foreground">
                      {count(site.weighted_daily_traffic)} pessoas/dia (ponderado)
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </RequestState>
        </div>
      </SheetContent>
    </Sheet>
  );
}
