import { Users } from "lucide-react";

import { AREA_EMPTY, type AreaQuestion, type Areas } from "@/lib/overview/areas";
import { Block } from "./shared";

function Column({ title, hint, items }: { title: string; hint: string; items: AreaQuestion[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{AREA_EMPTY}</p>
      ) : (
        items.map((q) => (
          <div key={q.question} className="rounded-lg border p-3">
            <p className="text-sm font-medium">{q.question}</p>
            <p className="text-sm text-muted-foreground">{q.answer}</p>
          </div>
        ))
      )}
    </div>
  );
}

/** O que cada pessoa pode olhar: perguntas com a resposta dos dados, nunca ordens nem causas. */
export function AreasCard({ areas }: { areas: Areas }) {
  return (
    <Block title="O que cada área pode olhar" icon={<Users className="size-4 text-primary" />}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Column title="Sócios" hint="O quadro geral" items={areas.socios} />
        <Column title="Operação" hint="Lojas, produtos e estoque" items={areas.operacao} />
        <Column title="Financeiro" hint="Dinheiro, notas e saídas" items={areas.financeiro} />
      </div>
      <p className="text-xs text-muted-foreground">São perguntas para conversar, com o que os números mostram. Não dizem o motivo nem mandam fazer algo.</p>
    </Block>
  );
}
