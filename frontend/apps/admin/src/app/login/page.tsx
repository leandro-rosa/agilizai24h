"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);

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
    // Fundo sempre escuro dos dois lados, independente do tema do painel —
    // mesma decisão de `.brand-surface`/`.brand-sidebar` (o lockup só existe
    // sobre superfície escura). Antes o lado direito seguia `bg-background`
    // (creme no claro); pedido explícito do operador sobre um mockup novo
    // de login: os dois lados ficam escuros sempre.
    <div className="flex min-h-svh flex-col bg-[#0a0a0d] md:grid md:grid-cols-2">
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
      <aside className="brand-surface relative flex flex-col p-8 md:p-12">
        <div className="flex flex-1 flex-col justify-center gap-6">
          <div className="flex items-center gap-4">
            <BrandMark variant="symbol-white" height={140} />
            <span className="text-5xl font-bold tracking-tight md:text-6xl">agiliz.ai</span>
          </div>
          <p className="max-w-sm text-lg font-semibold md:text-2xl">
            Feito para quem não tem tempo a perder.
          </p>
        </div>
        <div className="hidden items-end justify-between md:flex">
          <p className="text-sm opacity-75">Painel de gestão do Agiliz.AI</p>
          {/* Toque decorativo do mockup — texto pequeno empilhado, sem link/ação. */}
          <span className="text-right text-[10px] font-semibold leading-[1.6] tracking-[0.2em] text-white/40 uppercase">
            Mais
            <br />
            Tempo
            <br />
            Mais
            <br />
            Resultados
          </span>
        </div>
      </aside>

      <main className="brand-canvas relative flex flex-1 items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-sm">
          <div className="mb-6 flex flex-col items-center gap-4 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand-magenta)] to-[var(--brand-purple)] shadow-lg">
              <BrandMark variant="symbol-white" height={36} />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Entrar no Agiliz Admin</h1>
              <p className="mt-1 text-sm text-white/60">Use a conta de operador do Agiliz.AI.</p>
            </div>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white/80">E-mail</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
                        <Input
                          type="email"
                          autoComplete="username"
                          placeholder="voce@agiliz.ai"
                          className="border-white/15 bg-white/5 pl-9 text-white placeholder:text-white/30"
                          {...field}
                        />
                      </div>
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
                    <FormLabel className="text-white/80">Senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          className="border-white/15 bg-white/5 px-9 text-white"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-white/40 hover:text-white/70"
                          aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
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
              <Button
                type="submit"
                disabled={isLoading}
                className="mt-2 w-full bg-gradient-to-r from-[var(--brand-magenta)] to-[#ff4fa8] text-white hover:opacity-90"
              >
                {isLoading ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          </Form>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-white/40">
            <span className="h-px flex-1 bg-white/10" />
            <ShieldCheck className="size-3.5 shrink-0" />
            <span className="text-center">Acesso restrito a operadores autorizados</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
        </div>
        {/* Mesmo toque decorativo do lado esquerdo, espelhado. */}
        <span className="pointer-events-none absolute right-8 bottom-8 hidden text-right text-[10px] font-semibold leading-[1.6] tracking-[0.2em] text-white/30 uppercase md:block">
          Agiliz.ai
          <br />
          Sempre à frente
        </span>
      </main>
    </div>
  );
}
