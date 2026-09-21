"use client";

import { AlertTriangle, CheckCircle2, Loader2, OctagonAlert } from "lucide-react";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalysisAvailability, AvailabilityState } from "@/lib/commercial-intelligence/availability";

const STATE: Record<AvailabilityState, { label: string; tone: StatusTone; Icon: typeof CheckCircle2 }> = {
  available: { label: "Análise disponível", tone: "positive", Icon: CheckCircle2 },
  caveats: { label: "Disponível com ressalvas", tone: "attention", Icon: AlertTriangle },
  insufficient: { label: "Dados insuficientes", tone: "critical", Icon: OctagonAlert },
  loading: { label: "Carregando", tone: "neutral", Icon: Loader2 },
};

/** Text and an icon, never colour alone. */
function StateBadge({ state }: { state: AvailabilityState }) {
  const { label, tone, Icon } = STATE[state];
  return (
    <StatusBadge tone={tone}>
      <Icon className={state === "loading" ? "size-3 animate-spin" : "size-3"} aria-hidden />
      {label}
    </StatusBadge>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="text-sm">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: AnalysisAvailability }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {analysis.title}
          <StateBadge state={analysis.state} />
        </CardTitle>
        <CardDescription>{analysis.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {analysis.indicators.map((indicator) => (
            <div key={indicator.label} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{indicator.label}</dt>
              <dd className="tabular text-lg font-semibold">{indicator.value}</dd>
              {indicator.reference && <dd className="text-xs text-muted-foreground">{indicator.reference}</dd>}
            </div>
          ))}
        </dl>
        <List title="O que bloqueia" items={analysis.blockers} />
        <List title="O que reduz a confiança" items={analysis.caveats} />
        <List title="O que destrava" items={analysis.unblock} />
      </CardContent>
    </Card>
  );
}

/**
 * Whether each analysis can run on today's data, and why. The three states are
 * different things: only "Dados insuficientes" stops an analysis; a weakness
 * merely lowers its confidence and is listed. The limits that separate the states
 * are data-quality criteria, shown here as reference text and never as settings.
 */
export function QualityTab({ availability }: { availability: AnalysisAvailability[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Quais análises os dados permitem hoje</CardTitle>
          <CardDescription>
            Cada análise mostra os indicadores que decidem se ela pode rodar. <strong>Só bloqueia o que a torna impossível ou enganosa</strong>; o que apenas a enfraquece continua
            disponível, com a ressalva listada e a confiança menor.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="grid gap-2 sm:grid-cols-3">
            <li className="flex flex-col gap-1">
              <StateBadge state="available" />
              <span className="text-muted-foreground">Nada enfraquece a análise.</span>
            </li>
            <li className="flex flex-col gap-1">
              <StateBadge state="caveats" />
              <span className="text-muted-foreground">Roda, com limitações claras e confiança reduzida.</span>
            </li>
            <li className="flex flex-col gap-1">
              <StateBadge state="insufficient" />
              <span className="text-muted-foreground">Não roda: seria impossível ou enganoso. Diz o que destrava.</span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Os limites que separam os estados são critérios de qualidade provisórios, ainda não calibrados com meses reais. Ficam em Configurações avançadas / calibração — não são ajustes desta tela.
          </p>
        </CardContent>
      </Card>

      {availability.map((analysis) => (
        <AnalysisCard key={analysis.id} analysis={analysis} />
      ))}
    </div>
  );
}
