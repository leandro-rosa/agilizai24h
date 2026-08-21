"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, type DefaultValues, type FieldValues, type Path, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import type { ZodType } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FieldSpec<T extends FieldValues> =
  | { name: Path<T>; label: string; kind: "text" | "number" | "date" | "email"; placeholder?: string; hint?: string }
  | { name: Path<T>; label: string; kind: "select"; options: { value: string; label: string }[]; hint?: string };

/**
 * O formulário de CRUD de todo domínio novo, num lugar só.
 *
 * Sem ele cada uma das doze telas reescreve a mesma combinação de Dialog +
 * react-hook-form + zod + mutation + tratamento de erro — e cada cópia
 * trata 403 e erro de validação do servidor de um jeito ligeiramente
 * diferente, que é como a inconsistência entra.
 */
export function ResourceFormDialog<T extends FieldValues>({
  title,
  description,
  trigger,
  schema,
  fields,
  defaultValues,
  submitLabel = "Salvar",
  onSubmit,
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  description?: string;
  trigger?: React.ReactNode;
  schema: ZodType<T, T>;
  fields: FieldSpec<T>[];
  defaultValues: DefaultValues<T>;
  submitLabel?: string;
  onSubmit: (values: T) => Promise<unknown>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const form = useForm<T>({
    // O cast existe porque `schema` é genérico: o zodResolver quer um schema
    // concreto, e sem ele o tipo do formulário viraria FieldValues e cada
    // tela perderia a checagem dos próprios campos.
    resolver: zodResolver(schema) as unknown as Resolver<T>,
    defaultValues,
  });

  // Reabrir para editar outro registro precisa recarregar os valores: o
  // react-hook-form só lê defaultValues na montagem, e sem isto o segundo
  // "editar" mostraria os dados do primeiro.
  useEffect(() => {
    if (open) form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultValues é recriado a cada render por quem chama
  }, [open]);

  async function handleSubmit(values: T) {
    try {
      await onSubmit(values);
      toast.success(`${title} salvo.`);
      setOpen(false);
    } catch (error) {
      // 403 tem mensagem própria: o operador está autenticado, só não tem a
      // permissão — dizer "erro ao salvar" ali manda depurar a coisa errada.
      const status = (error as { status?: number })?.status;
      const detail = (error as { data?: { message?: string | string[] } })?.data?.message;

      toast.error(
        status === 403
          ? "Sem permissão para esta ação."
          : Array.isArray(detail)
            ? detail.join(" · ")
            : (detail ?? "Não foi possível salvar."),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col gap-4" noValidate>
            {fields.map((spec) => (
              <FormField
                key={String(spec.name)}
                control={form.control}
                name={spec.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{spec.label}</FormLabel>
                    <FormControl>
                      {spec.kind === "select" ? (
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {spec.options.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type={spec.kind === "number" ? "number" : spec.kind === "date" ? "date" : spec.kind}
                          placeholder={spec.placeholder}
                          {...field}
                          value={field.value ?? ""}
                          className={spec.kind === "number" ? "tabular" : undefined}
                        />
                      )}
                    </FormControl>
                    {spec.hint && <p className="text-xs text-muted-foreground">{spec.hint}</p>}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <DialogFooter className="mt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Salvando..." : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Reais → centavos, para o formulário falar em R$ e a API em inteiro. */
export function toCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}
