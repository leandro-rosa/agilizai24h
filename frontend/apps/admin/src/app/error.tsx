"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
      <p className="text-base font-medium">Algo deu errado ao montar esta tela.</p>
      <p className="text-sm text-muted-foreground">Seus dados não foram alterados. Tente de novo ou volte ao início.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Tentar novamente</Button>
        <Button variant="outline" asChild>
          <Link href="/">Ir para o início</Link>
        </Button>
      </div>
    </div>
  );
}
