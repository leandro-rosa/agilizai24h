import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-base font-medium">Esta página não existe.</p>
      <p className="text-sm text-muted-foreground">O endereço pode ter mudado. Use o menu para encontrar a tela.</p>
      <Button asChild>
        <Link href="/">Ir para o início</Link>
      </Button>
    </div>
  );
}
