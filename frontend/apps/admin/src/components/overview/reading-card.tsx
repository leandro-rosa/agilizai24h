import { FileText } from "lucide-react";

import { Block } from "./shared";

export function ReadingCard({ reading, limitations }: { reading: string; limitations: string[] }) {
  return (
    <Block title="Leitura do mês" icon={<FileText className="size-4 text-primary" />}>
      <p className="max-w-4xl text-sm leading-relaxed">{reading || "Sem dados suficientes para uma leitura do mês."}</p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">O que este resumo ainda não consegue mostrar</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
    </Block>
  );
}
