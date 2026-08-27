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
  KIND_LABELS,
  MAPPING_KINDS,
  MATCH_TYPE_LABELS,
  MATCH_TYPES,
  NATURE_LABELS,
  NATURES,
  useCreateMappingMutation,
  useDeleteMappingMutation,
  useGetMappingsQuery,
  useUpdateMappingMutation,
  type CounterpartyMapping,
} from "@/lib/api/treasury";
import { useHasPermission } from "@/lib/auth/use-permission";

const mappingSchema = z
  .object({
    match_text: z.string().min(1, "Informe a grafia"),
    display_name: z.string().min(1, "Informe o nome"),
    entry_type: z.string().min(1, "Informe o tipo"),
    category: z.string().min(1, "Informe a categoria"),
    kind: z.enum(MAPPING_KINDS),
    // Só obrigatória para kind "expense" — mesma regra da tela de lançamentos.
    nature: z.enum(NATURES).optional(),
    match_type: z.enum(MATCH_TYPES),
  })
  .refine((values) => values.kind !== "expense" || values.nature !== undefined, {
    message: "Informe a natureza para despesa",
    path: ["nature"],
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
  {
    name: "match_type",
    label: "Como bate",
    kind: "select",
    options: MATCH_TYPES.map((m) => ({ value: m, label: MATCH_TYPE_LABELS[m] })),
    hint: '"Exato" é o padrão. "Contém" é para palavra-chave (ex.: texto contém "POSTO" ⇒ Combustível).',
  },
  { name: "display_name", label: "Nome de exibição", kind: "text", placeholder: "Assaí Atacadista" },
  { name: "entry_type", label: "Tipo", kind: "text", placeholder: "estoque" },
  { name: "category", label: "Categoria", kind: "text", placeholder: "estoque geral" },
  {
    name: "kind",
    label: "Tipo de lançamento",
    kind: "select",
    options: MAPPING_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
    hint: "Movimentação nunca conta como receita/despesa (ex.: transferência entre contas próprias, fatura, CDB, sócio).",
  },
  {
    name: "nature",
    label: "Natureza",
    kind: "select",
    options: NATURES.map((n) => ({ value: n, label: NATURE_LABELS[n] })),
    hint: "Só se aplica quando o tipo é Despesa.",
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
              defaultValues={{ kind: "expense", nature: "cogs", match_type: "exact" } as MappingForm}
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
              <TableHead>Classificação</TableHead>
              {canWrite && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(mappings ?? []).map((mapping) => (
              <TableRow key={mapping.id}>
                <TableCell className="font-mono text-xs">
                  {mapping.match_text}
                  {mapping.match_type === "contains" && (
                    <span className="ml-1 text-muted-foreground">(contém)</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{mapping.display_name}</TableCell>
                <TableCell>{mapping.entry_type}</TableCell>
                <TableCell>{mapping.category}</TableCell>
                <TableCell>
                  {KIND_LABELS[mapping.kind] ?? mapping.kind}
                  {mapping.nature && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({NATURE_LABELS[mapping.nature] ?? mapping.nature})
                    </span>
                  )}
                </TableCell>
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
              kind: editing.kind,
              nature: editing.nature ?? undefined,
              match_type: editing.match_type,
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
