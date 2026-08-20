"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { RequestState } from "@/components/request-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHasPermission } from "@/lib/auth/use-permission";
import {
  INGESTION_FILE_TYPES,
  useGetIngestionQuery,
  useListIngestionsQuery,
  useUploadIngestionMutation,
  type IngestionFileType,
  type IngestionStatus,
} from "@/lib/api/ingestion";
import { useGetStoresQuery } from "@/lib/api/stores";

const FILE_TYPE_LABELS: Record<IngestionFileType, string> = {
  sales: "Vendas",
  supply: "Abastecimento",
  cost: "Custos",
};

const STATUS_LABELS: Record<IngestionStatus, string> = {
  accepted: "Aceito",
  processing: "Processando",
  completed: "Concluído",
  partially_completed: "Parcialmente concluído",
  failed: "Falhou",
};

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const ingestionSchema = z
  .object({
    file_type: z.enum(["sales", "supply", "cost"], { error: "Selecione o tipo de arquivo" }),
    store_id: z.string().optional(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o período como AAAA-MM"),
    file: z.instanceof(File).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.file_type !== "supply" && !values.store_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["store_id"], message: "Selecione a loja" });
    }
    if (!values.file) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["file"], message: "Selecione um arquivo" });
    }
  });

type IngestionFormValues = z.infer<typeof ingestionSchema>;

function StatusBadge({ status }: { status: IngestionStatus }) {
  if (status === "completed") return <Badge variant="secondary">{STATUS_LABELS[status]}</Badge>;
  if (status === "failed") {
    return <Badge className="border border-destructive/30 bg-destructive/10 text-destructive">{STATUS_LABELS[status]}</Badge>;
  }
  if (status === "partially_completed") {
    return <Badge className="border border-warning/30 bg-warning/15 text-warning">{STATUS_LABELS[status]}</Badge>;
  }
  return <Badge variant="outline">{STATUS_LABELS[status]}</Badge>;
}

function UploadCard() {
  const canUpload = useHasPermission("ingestion:upload");
  const { data: stores } = useGetStoresQuery();
  const [uploadIngestion, { isLoading }] = useUploadIngestionMutation();

  const form = useForm<IngestionFormValues>({
    resolver: zodResolver(ingestionSchema),
    defaultValues: { file_type: "sales", store_id: "", period: "", file: undefined },
  });

  const fileType = form.watch("file_type");

  async function onSubmit(values: IngestionFormValues) {
    if (!values.file) return;
    try {
      await uploadIngestion({
        file: values.file,
        file_type: values.file_type,
        store_id: values.file_type !== "supply" && values.store_id ? Number(values.store_id) : undefined,
        period: values.period,
      }).unwrap();
      toast.success("Arquivo enviado. Acompanhe o status na lista abaixo.");
      form.reset({ file_type: values.file_type, store_id: "", period: "", file: undefined });
    } catch {
      toast.error("Não foi possível enviar o arquivo. Tente novamente.");
    }
  }

  if (!canUpload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Enviar planilha</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Sua conta não tem permissão para enviar planilhas.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enviar planilha</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="file_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de arquivo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {INGESTION_FILE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {FILE_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {fileType !== "supply" && (
                <FormField
                  control={form.control}
                  name="store_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loja</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a loja" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(stores ?? []).map((store) => (
                            <SelectItem key={store.id} value={String(store.id)}>
                              {store.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="period"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Período</FormLabel>
                    <FormControl>
                      <Input type="month" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="file"
                render={({ field: { value, onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>Arquivo</FormLabel>
                    <FormControl>
                      <Input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => onChange(event.target.files?.[0])} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={isLoading} className="self-start">
              {isLoading ? "Enviando..." : "Enviar"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function IngestionHistory() {
  const canRead = useHasPermission("ingestion:read");
  const { data: ingestions, isLoading, error, refetch } = useListIngestionsQuery({ limit: 50 }, { skip: !canRead });
  const { data: stores } = useGetStoresQuery();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: detail, isLoading: detailLoading } = useGetIngestionQuery(selectedId ?? "", { skip: !selectedId });

  const nameByStoreId = new Map((stores ?? []).map((store) => [store.id, store.name]));

  return (
    <>
      <div className="rounded-lg border">
        <RequestState
          isLoading={isLoading}
          error={error}
          isEmpty={!isLoading && !error && (ingestions?.length ?? 0) === 0}
          emptyMessage="Nenhuma ingestão registrada ainda."
          onRetry={refetch}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aceitas</TableHead>
                <TableHead className="text-right">Rejeitadas</TableHead>
                <TableHead>Enviado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(ingestions ?? []).map((ingestion) => (
                <TableRow key={ingestion.id} className="cursor-pointer" onClick={() => setSelectedId(ingestion.id)}>
                  <TableCell className="font-medium">{ingestion.original_name}</TableCell>
                  <TableCell>{FILE_TYPE_LABELS[ingestion.file_type]}</TableCell>
                  <TableCell>
                    {ingestion.store_id === null ? "Rede" : nameByStoreId.get(ingestion.store_id) ?? ingestion.store_id}
                  </TableCell>
                  <TableCell>{ingestion.period}</TableCell>
                  <TableCell>
                    <StatusBadge status={ingestion.status} />
                  </TableCell>
                  <TableCell className="text-right">{ingestion.accepted_rows}</TableCell>
                  <TableCell className="text-right">{ingestion.rejected_rows}</TableCell>
                  <TableCell>{dateTimeFormatter.format(new Date(ingestion.uploaded_at))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </RequestState>
      </div>

      <Dialog open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.original_name ?? "Detalhe da ingestão"}</DialogTitle>
            <DialogDescription>{detail ? `${detail.accepted_rows} aceitas, ${detail.rejected_rows} rejeitadas` : ""}</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : detail && detail.rejections.length > 0 ? (
            <>
              {detail.rejected_rows > 100 && <p className="text-xs text-muted-foreground">Mostrando as 100 primeiras rejeições.</p>}
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Detalhe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.rejections.map((rejection) => (
                      <TableRow key={rejection.id}>
                        <TableCell className="font-mono text-xs">{rejection.row_reference}</TableCell>
                        <TableCell>{rejection.reason}</TableCell>
                        <TableCell>{rejection.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma linha rejeitada.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function IngestionPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ingestão" description="Envio de planilhas de vendas, abastecimento e custos, e histórico de processamento." />
      <UploadCard />
      <div>
        <h2 className="mb-2 text-sm font-medium">Histórico</h2>
        <IngestionHistory />
      </div>
    </div>
  );
}
