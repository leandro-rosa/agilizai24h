"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useLoginMutation } from "@/lib/api/auth";

const loginSchema = z.object({
  email: z.string().min(1, "Informe o e-mail").email("E-mail inválido"),
  password: z.string().min(1, "Informe a senha"),
});

type LoginValues = z.infer<typeof loginSchema>;

/**
 * A generic failure message that never reveals whether the email or the
 * password was wrong — the gateway's own login response is deliberately
 * generic for the same reason (see `AuthController`'s 401 doc).
 */
const GENERIC_LOGIN_ERROR = "E-mail ou senha incorretos.";

export default function LoginPage() {
  const router = useRouter();
  const [login, { isLoading }] = useLoginMutation();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);

    try {
      await login(values).unwrap();
      router.push("/");
    } catch {
      // Every failure reason — wrong email, wrong password, account
      // disabled — surfaces identically here, by design.
      setFormError(GENERIC_LOGIN_ERROR);
    }
  }

  return (
    <div className="flex min-h-svh flex-col md:grid md:grid-cols-2">
      {/*
        `.brand-surface` precisa da mesma superfície escura nos DOIS temas —
        `bg-background` o apagaria no claro, e carvão chapado o funde com o
        fundo no escuro, fazendo o split sumir. É o gradiente que a prancha
        07 designa para fundo, e se distingue de creme e de carvão.

        O grupo símbolo+wordmark+frase fica centralizado no espaço acima da
        linha de crédito (`flex-1 justify-center` no wrapper interno, não no
        `<aside>` inteiro) — pedido explícito, junto com o símbolo maior:
        "mais embaixo" sozinho colou tudo rente à base; centralizado é o
        meio-termo entre isso e o topo onde estava antes.
      */}
      <aside className="brand-surface flex flex-col p-8 md:p-12">
        <div className="flex flex-1 flex-col justify-center gap-6">
          <div className="flex items-center gap-4">
            <BrandMark variant="symbol-white" height={140} />
            <span className="text-5xl font-bold tracking-tight md:text-6xl">agiliz.ai</span>
          </div>
          <p className="max-w-sm text-lg font-semibold md:text-2xl">
            Feito para quem não tem tempo a perder.
          </p>
        </div>
        <p className="hidden text-sm opacity-75 md:block">Painel de gestão do Agiliz.AI</p>
      </aside>

      <main className="brand-canvas flex flex-1 items-center justify-center bg-background p-6 md:p-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight">Entrar no Agiliz Admin</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">Use a conta de operador do Agiliz.AI.</p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="username" placeholder="voce@agiliz.ai" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <Button type="submit" disabled={isLoading} className="mt-2 w-full">
                {isLoading ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          </Form>
        </div>
      </main>
    </div>
  );
}
