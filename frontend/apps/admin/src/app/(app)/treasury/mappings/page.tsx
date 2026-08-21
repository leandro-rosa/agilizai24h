"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { ResourceFormDialog, type FieldSpec } from "@/components/resource-form-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  NATURE_LABELS,
  NATURES,
  useCreateMappingMutation,
  useDeleteMappingMutation,
  useGetMappingsQuery,
  useUpdateMappingMutation,
  type CounterpartyMapping,
} from "@/lib/api/treasury";
import { useHasPermission } from "@/lib/auth/use-permission";

const mappingSchema = z.object({
  match_text: z.string().min(1, "Informe a grafia"),
  display_name: z.string().min(1, "Informe o nome"),
  entry_type: z.string().min(1, "Informe o tipo"),
  category: z.string().min(1, "Informe a categoria"),
  nature: z.enum(NATURES),
});

type MappingForm = z.infer<typeof mappingSchema>;

const FIELDS: FieldSpec<MappingForm>[] = [
  {
    name: "match_text",
    label: "Grafia no extrato",
    kind: "text",
    placeholder: "ASSAÍ ATACADISTA LJ49",
    hint: "É normalizada — caixa, acento e pontuação não importam.",
  },
  { name: "display_name", label: "Nome de exibição", kind: "text", placeholder: "Assaí Atacadista" },
  { name: "entry_type", label: "Tipo", kind: "text", placeholder: "estoque" },
  { name: "category", label: "Categoria", kind: "text", placeholder: "estoque geral" },
  {
    name: "nature",
    label: "Natureza",
    kind: "select",
    options: NATURES.map((n) => ({ value: n, label: NATURE_LABELS[n] })),
  },
];

export default function MappingsPage() {
  const { data: mappings, isLoading, error, refetch } = useGetMappingsQuery();
  const [createMapping] = useCreateMappingMutation();
  const [updateMapping] = useUpdateMappingMutation();
  const [deleteMapping] = useDeleteMappingMutation();
  const canWrite = useHasPermission("treasury:write");
  const [editing, setEditing] = useState<CounterpartyMapping | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="De-para"
        description="Como cada favorecido do extrato é classificado. É regra de negócio editável, não constante de código."
        actions={
          canWrite ? (
            <ResourceFormDialog
              title="Nova regra"
              trigger={
                <Button>
                  <Plus /> Nova regra
                </Button>
              }
              schema={mappingSchema}
              fields={FIELDS}
              defaultValues={{ nature: "cogs" } as MappingForm}
              onSubmit={(values) => createMapping(values).unwrap()}
            />
          ) : null
        }
      />

      <RequestState
        isLoading={isLoading}
        error={error}
        isEmpty={(mappings ?? []).length === 0}
        emptyMessage="Nenhuma regra cadastrada."
        onRetry={refetch}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grafia normalizada</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Natureza</TableHead>
              {canWrite && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(mappings ?? []).map((mapping) => (
              <TableRow key={mapping.id}>
                <TableCell className="font-mono text-xs">{mapping.match_text}</TableCell>
                <TableCell className="font-medium">{mapping.display_name}</TableCell>
                <TableCell>{mapping.entry_type}</TableCell>
                <TableCell>{mapping.category}</TableCell>
                <TableCell>{NATURE_LABELS[mapping.nature] ?? mapping.nature}</TableCell>
                {canWrite && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => setEditing(mapping)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" title="Excluir" onClick={() => deleteMapping(mapping.id)}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </RequestState>

      {editing && (
        <ResourceFormDialog
          key={editing.id}
          title={`Editar ${editing.display_name}`}
          schema={mappingSchema}
          fields={FIELDS}
          defaultValues={
            {
              match_text: editing.match_text,
              display_name: editing.display_name,
              entry_type: editing.entry_type,
              category: editing.category,
              nature: editing.nature,
            } as MappingForm
          }
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={(values) => updateMapping({ id: editing.id, ...values }).unwrap()}
        />
      )}
    </div>
  );
}
