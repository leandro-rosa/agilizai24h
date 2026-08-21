"use client";

import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, type FieldSpec } from "@/components/resource-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABELS,
  useAddAliasMutation,
  useCreateSupplierMutation,
  useGetSupplierQuery,
  useGetSuppliersQuery,
  useRemoveAliasMutation,
  useUpdateSupplierMutation,
  type Supplier,
} from "@/lib/api/suppliers";
import { useHasPermission } from "@/lib/auth/use-permission";

const supplierSchema = z.object({
  name: z.string().min(1, "Informe o nome"),
  legal_name: z.string().optional(),
  tax_id: z.string().optional(),
  category: z.enum(SUPPLIER_CATEGORIES),
  contact_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

type SupplierForm = z.infer<typeof supplierSchema>;

const FIELDS: FieldSpec<SupplierForm>[] = [
  { name: "name", label: "Nome", kind: "text", placeholder: "Quinoa Indústria de Alimentos" },
  { name: "legal_name", label: "Razão social", kind: "text" },
  { name: "tax_id", label: "CNPJ", kind: "text", placeholder: "35.370.333/0001-00" },
  {
    name: "category",
    label: "Categoria",
    kind: "select",
    options: SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: SUPPLIER_CATEGORY_LABELS[c] })),
  },
  { name: "contact_name", label: "Contato", kind: "text" },
  { name: "phone", label: "Telefone", kind: "text" },
  { name: "email", label: "E-mail", kind: "email" },
];

/** Só o que o formulário edita — `status` e `alias_count` ficam de fora. */
function toForm(supplier: Supplier): SupplierForm {
  return {
    name: supplier.name,
    legal_name: supplier.legal_name ?? "",
    tax_id: supplier.tax_id ?? "",
    category: supplier.category,
    contact_name: supplier.contact_name ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
  };
}

export default function SuppliersPage() {
  const { data: suppliers, isLoading, error, refetch } = useGetSuppliersQuery();
  const [createSupplier] = useCreateSupplierMutation();
  const [updateSupplier] = useUpdateSupplierMutation();
  const canWrite = useHasPermission("suppliers:write");

  const [editing, setEditing] = useState<Supplier | null>(null);
  const [aliasesOf, setAliasesOf] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const visible = (suppliers ?? []).filter((s) =>
    search ? s.name.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fornecedores"
        description="O cadastro e as grafias sob as quais cada fornecedor aparece no extrato."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Novo fornecedor"
              description="O nome vira o primeiro alias, para o cadastro já resolver contra o extrato."
              trigger={
                <Button>
                  <Plus /> Novo fornecedor
                </Button>
              }
              schema={supplierSchema}
              fields={FIELDS}
              defaultValues={{ name: "", category: "wholesale" } as SupplierForm}
              onSubmit={(values) => createSupplier(values).unwrap()}
            />
          ) : null
        }
      />

      <Input
        placeholder="Buscar por nome"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-xs"
      />

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={visible.length === 0}
        emptyMessage="Nenhum fornecedor cadastrado."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="tabular text-right">Grafias</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((supplier) => (
              <TableRow key={supplier.id}>
                <TableCell className="font-medium">{supplier.name}</TableCell>
                <TableCell className="tabular">{supplier.tax_id ?? "—"}</TableCell>
                <TableCell>{SUPPLIER_CATEGORY_LABELS[supplier.category] ?? supplier.category}</TableCell>
                <TableCell className="tabular text-right">{supplier.alias_count ?? 0}</TableCell>
                <TableCell>
                  <StatusBadge tone={supplier.status === "active" ? "positive" : "neutral"}>
                    {supplier.status === "active" ? "Ativo" : "Inativo"}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Grafias" onClick={() => setAliasesOf(supplier.id)}>
                    <Tags />
                  </Button>
                  {canWrite && (
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => setEditing(supplier)}>
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
          schema={supplierSchema}
          fields={FIELDS}
          defaultValues={toForm(editing) as SupplierForm}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(values) => updateSupplier({ id: editing.id, ...values }).unwrap()}
        />
      )}

      <AliasSheet supplierId={aliasesOf} onClose={() => setAliasesOf(null)} canWrite={canWrite} />
    </div>
  );
}

function AliasSheet({
  supplierId,
  onClose,
  canWrite,
}: {
  supplierId: number | null;
  onClose: () => void;
  canWrite: boolean;
}) {
  const { data, isLoading, error, refetch } = useGetSupplierQuery(supplierId as number, { skip: supplierId === null });
  const [addAlias] = useAddAliasMutation();
  const [removeAlias] = useRemoveAliasMutation();
  const [draft, setDraft] = useState("");

  async function submit() {
    if (!supplierId || !draft.trim()) return;
    await addAlias({ id: supplierId, alias: draft.trim() }).unwrap().catch(() => undefined);
    setDraft("");
  }

  return (
    <Sheet open={supplierId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Grafias de {data?.name ?? "…"}</SheetTitle>
          <SheetDescription>
            Cada grafia sob a qual este fornecedor aparece no extrato. Uma grafia só pode pertencer a um fornecedor.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {canWrite && (
            <div className="flex gap-2">
              <Input
                placeholder="ASSAÍ ATACADISTA LJ49"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && submit()}
              />
              <Button onClick={submit} disabled={!draft.trim()}>
                Adicionar
              </Button>
            </div>
          )}

          <RequestState
            isLoading={isLoading}
            error={error}
            isEmpty={(data?.aliases.length ?? 0) === 0}
            emptyMessage="Nenhuma grafia registrada."
            onRetry={refetch}
            loadingRows={3}
          >
            <ul className="flex flex-col gap-1">
              {data?.aliases.map((alias) => (
                <li key={alias.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{alias.alias}</p>
                    <p className="truncate text-xs text-muted-foreground">{alias.normalized_alias}</p>
                  </div>
                  {canWrite && supplierId !== null && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remover"
                      onClick={() => removeAlias({ id: supplierId, aliasId: alias.id })}
                    >
                      <Trash2 />
                    </Button>
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
