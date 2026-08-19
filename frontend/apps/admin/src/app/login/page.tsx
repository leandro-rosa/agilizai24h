"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span className="brand-gradient mb-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white">
            A
          </span>
          <CardTitle className="text-xl">Entrar no Agiliz Admin</CardTitle>
          <CardDescription>Painel de gestão do Agiliz.AI</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
