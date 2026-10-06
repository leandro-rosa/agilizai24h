import { FileText } from "lucide-react";

import { plainify } from "@/lib/overview/plain";
import { Block } from "./shared";

export function ReadingCard({ reading }: { reading: string }) {
  return (
    <Block title="Leitura do mês" icon={<FileText className="size-4 text-primary" />}>
      <p className="max-w-4xl text-sm leading-relaxed">{plainify(reading) || "Sem dados suficientes para uma leitura do mês."}</p>
    </Block>
  );
}
