"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TREASURY_SOURCES,
  TREASURY_SOURCE_ACCOUNT_HINT,
  TREASURY_SOURCE_LABELS,
  useGetAccountsQuery,
  useUploadStatementsMutation,
  type TreasurySource,
} from "@/lib/api/treasury";
import { currentPeriod } from "@/lib/format";
import { useHasPermission } from "@/lib/auth/use-permission";

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Um par file/account_id por fonte, escrito explícito (em vez de gerado a
// partir de TREASURY_SOURCES) porque é o mesmo estilo do resto do app
// (transactionSchema, mappingSchema) — nenhum outro formulário aqui gera
// schema dinamicamente.
const uploadSchema = z
  .object({
    period: z.string().regex(PERIOD_PATTERN, "Informe o período como AAAA-MM"),
    pagbank_statement_file: z.instanceof(File).optional(),
    pagbank_statement_account_id: z.string().optional(),
    c6_statement_file: z.instanceof(File).optional(),
    c6_statement_account_id: z.string().optional(),
    c6_invoice_file: z.instanceof(File).optional(),
    c6_invoice_account_id: z.string().optional(),
    pagseguro_invoice_file: z.instanceof(File).optional(),
    pagseguro_invoice_account_id: z.string().optional(),
    nubank_statement_file: z.instanceof(File).optional(),
    nubank_statement_account_id: z.string().optional(),
    bradesco_statement_file: z.instanceof(File).optional(),
    bradesco_statement_account_id: z.string().optional(),
    itau_statement_file: z.instanceof(File).optional(),
    itau_statement_account_id: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    const record = values as unknown as Record<string, unknown>;
    const chosen = TREASURY_SOURCES.filter((source) => record[`${source}_file`]);

    if (chosen.length === 0) {
      ctx.addIssue({ code: "custom", path: ["period"], message: "Selecione ao menos um arquivo" });
    }
    for (const source of chosen) {
      if (!record[`${source}_account_id`]) {
        ctx.addIssue({ code: "custom", path: [`${source}_account_id`], message: "Selecione a conta" });
      }
    }
  });

type UploadForm = z.infer<typeof uploadSchema>;

export default function TreasuryUploadPage() {
  const router = useRouter();
  const canWrite = useHasPermission("treasury:write");
  const { data: accounts } = useGetAccountsQuery();
  const [uploadStatements, { isLoading }] = useUploadStatementsMutation();

  const form = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: { period: currentPeriod() },
  });

  async function onSubmit(values: UploadForm) {
    const record = values as unknown as Record<string, unknown>;
    const files = TREASURY_SOURCES.filter((source) => record[`${source}_file`]).map((source) => ({
      source,
      account_id: Number(record[`${source}_account_id`]),
      file: record[`${source}_file`] as File,
    }));

    try {
      const result = await uploadStatements({ period: values.period, files }).unwrap();
      const sources = result.queued.map((q) => q.source).join(",");
      toast.success(`${result.queued.length} arquivo(s) enviado(s). Acompanhe a conferência abaixo.`);
      router.push(`/treasury/imports/${values.period}?sources=${sources}`);
    } catch (err) {
      const status = (err as { status?: unknown })?.status;
      const message = (err as { data?: { message?: string } })?.data?.message;
      const isClientError = typeof status === "number" && status >= 400 && status < 500;
      toast.error(isClientError && message ? message : "Não foi possível enviar os arquivos. Tente novamente.");
    }
  }

  if (!canWrite) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Importar extratos" description="Extrato bancário e fatura de cartão do mês." />
        <p className="text-sm text-muted-foreground">Sua conta não tem permissão para enviar extratos.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Importar extratos"
        description="Suba os arquivos do mês — pode ser só alguns, não precisa dos seis de uma vez."
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Competência</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="period"
                render={({ field }) => (
                  <FormItem className="max-w-40">
                    <FormControl>
                      <Input type="month" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {TREASURY_SOURCES.map((source) => (
            <SourceCard key={source} source={source} form={form} accounts={accounts ?? []} />
          ))}

          <Button type="submit" disabled={isLoading} className="self-start">
            {isLoading ? "Enviando..." : "Enviar"}
          </Button>
        </form>
      </Form>
    </div>
  );
}

function SourceCard({
  source,
  form,
  accounts,
}: {
  source: TreasurySource;
  form: ReturnType<typeof useForm<UploadForm>>;
  accounts: { id: number; name: string; institution: string; kind: string }[];
}) {
  const fileFieldName = `${source}_file` as const;
  const accountFieldName = `${source}_account_id` as const;
  const file = form.watch(fileFieldName as "pagbank_statement_file") as File | undefined;
  const hint = TREASURY_SOURCE_ACCOUNT_HINT[source];
  const suggested = accounts.find((a) => a.institution === hint.institution && a.kind === hint.kind);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{TREASURY_SOURCE_LABELS[source]}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name={fileFieldName as "pagbank_statement_file"}
          render={({ field: { value: _value, onChange, ...field } }) => (
            <FormItem>
              <FormLabel>Arquivo</FormLabel>
              <FormControl>
                <Input
                  type="file"
                  accept=".pdf,.csv"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    onChange(chosen);
                    if (chosen && !form.getValues(accountFieldName as "pagbank_statement_account_id") && suggested) {
                      form.setValue(accountFieldName as "pagbank_statement_account_id", String(suggested.id));
                    }
                  }}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {file && (
          <FormField
            control={form.control}
            name={accountFieldName as "pagbank_statement_account_id"}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Conta</FormLabel>
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a conta" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={String(account.id)}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </CardContent>
    </Card>
  );
}
