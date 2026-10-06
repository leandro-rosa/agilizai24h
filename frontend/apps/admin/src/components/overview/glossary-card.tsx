import { BookOpen } from "lucide-react";

import { GLOSSARY } from "@/lib/overview/plain";
import { Block } from "./shared";

/** "Como ler este relatório": os termos em uma frase, recolhido para não pesar quem já conhece. */
export function GlossaryCard({ limitations }: { limitations: string[] }) {
  return (
    <Block title="Como ler este relatório" icon={<BookOpen className="size-4 text-primary" />}>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Ver o significado de cada termo</summary>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 lg:grid-cols-2">
          {GLOSSARY.map((g) => (
            <div key={g.term}>
              <dt className="text-sm font-medium">{g.term}</dt>
              <dd className="text-sm text-muted-foreground">{g.meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs font-medium text-muted-foreground">O que este relatório ainda não consegue mostrar</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </details>
    </Block>
  );
}
