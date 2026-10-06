import { Sun } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Brief } from "@/lib/overview/brief";
import type { Light } from "@/lib/overview/plain";

const STYLE: Record<Light, { dot: string; text: string; border: string }> = {
  better: { dot: "bg-success", text: "text-success", border: "border-success/40" },
  same: { dot: "bg-warning", text: "text-warning", border: "border-warning/40" },
  worse: { dot: "bg-destructive", text: "text-destructive", border: "border-destructive/40" },
  nodata: { dot: "bg-muted-foreground", text: "text-muted-foreground", border: "border-border" },
};

/** "O mês em 1 minuto": uma frase, seis cards com semáforo e as 3 coisas mais importantes — para quem não é de números. */
export function BriefCard({ brief }: { brief: Brief }) {
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
          <Sun className="size-4" /> O mês em 1 minuto
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="max-w-4xl text-xl font-semibold leading-snug">{brief.headline}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {brief.cards.map((c) => {
            const st = STYLE[c.light.tone];
            return (
              <div key={c.key} className={`flex flex-col gap-1 rounded-lg border p-4 ${st.border}`}>
                <p className="text-sm text-muted-foreground">{c.question}</p>
                <p className="tabular text-3xl font-semibold">{c.value}</p>
                <p className={`flex items-center gap-2 text-sm font-medium ${st.text}`}>
                  <span className={`inline-block size-2.5 rounded-full ${st.dot}`} /> {c.light.label}
                </p>
                <p className="text-sm text-muted-foreground">{c.sentence}</p>
              </div>
            );
          })}
        </div>
        {brief.threeThings.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">3 coisas para saber</p>
            <ol className="flex list-decimal flex-col gap-2 pl-5">
              {brief.threeThings.map((t) => (
                <li key={t.title} className="text-sm">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-muted-foreground"> — {t.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Verde = melhor que o normal · Amarelo = parecido (até 3% de diferença) · Vermelho = pior. “Normal” é o mês anterior e a média dos 3 meses antes. “Perdemos menos” é bom.
        </p>
      </CardContent>
    </Card>
  );
}
