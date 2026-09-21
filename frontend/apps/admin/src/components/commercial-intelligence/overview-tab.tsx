"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeDelta, type MarginAfterLoss, type ScopeKpis } from "@/lib/commercial-intelligence/kpis";
import type { CommercialParameters } from "@/lib/commercial-intelligence/parameters";
import type { SourceStatus } from "@/lib/commercial-intelligence/quality";
import { count, money } from "@/lib/format";
import { decimal, pct } from "./format";
import { KpiCard, type KpiDelta, type KpiState } from "./kpi-card";
import { ProvenanceBadge } from "./provenance-badge";

export interface OverviewProps {
  /** The parameters in force: the impact scenarios and the number of opportunities the main screen shows. */
  parameters: CommercialParameters;
  /** The selected scope has no completed line at all: there is nothing to total, and zeros would read as "sold nothing". */
  scopeEmpty: boolean;
  scopeLabel: string;
  /** Whether the reader asked to compare with the previous month. */
  comparisonRequested: boolean;
  current: ScopeKpis;
  /** Null while the comparison period is loading, has no data, or was not asked for. */
  previous: ScopeKpis | null;
  costs: SourceStatus;
  /** The margin after losses is its own block: it needs costs AND a reconciliation, and either may be missing. */
  afterLoss: {
    status: SourceStatus;
    current: MarginAfterLoss;
    previous: MarginAfterLoss | null;
  };
}

/** What the page cannot know, said plainly. These are standing limits of the data, not results of any analysis. */
const STANDING_LIMITS = [
  "Não há estoque diário: só o saldo do mês. Ruptura e giro por dia não são observáveis — “sem vendas por vários dias” pode ser falta de produto ou pouca procura.",
  "Não há histórico de promoções: a elasticidade de preço não é medida. Qualquer desconto é um teste a fazer, nunca um ganho garantido.",
  "O painel não recebe a data de visita de abastecimento: a perda por dia de visita não existe; a perda é conhecida por mês, loja e produto.",
  "O catálogo tem só quatro categorias (refeição, snack, bebida, essencial) e as análises por categoria seguem o cadastro, sem dedução pelo nome.",
  "Só há um mês completo com detalhe por transação: a estabilidade entre meses ainda não pode ser medida.",
];

function stateForCosts(costs: SourceStatus, marginCents: number | null): KpiState {
  if (costs === "loading") return { kind: "loading" };
  if (costs === "no_permission") return { kind: "unavailable", reason: "Sem permissão" };
  if (costs === "error") return { kind: "unavailable", reason: "Indisponível" };
  if (marginCents === null) return { kind: "unavailable", reason: "Nenhum produto vendido tem custo resolvido" };
  return { kind: "value" };
}

/**
 * "Estimativa de impacto": how a potential will be shown once there are
 * opportunities. Three scenarios, never a single precise figure, and the premise
 * said plainly: it is a potential, not a measured or guaranteed result. Observed
 * and estimated values always sit side by side.
 */
function ImpactEstimateCard({ parameters }: { parameters: CommercialParameters }) {
  const { scenarioConservative, scenarioExpected, scenarioOptimistic } = parameters.impact;
  const scenarios = [
    { label: "Conservador", share: scenarioConservative },
    { label: "Esperado", share: scenarioExpected },
    { label: "Otimista", share: scenarioOptimistic },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Estimativa de impacto
          <ProvenanceBadge provenance="assumption" />
        </CardTitle>
        <CardDescription>
          Cada oportunidade vai mostrar o potencial em R$ por mês como uma <strong>faixa</strong> — por exemplo “potencial estimado de R$ 220–660/mês” —, nunca como um número artificialmente preciso.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="grid gap-3 sm:grid-cols-3">
          {scenarios.map((scenario) => (
            <li key={scenario.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Cenário {scenario.label.toLowerCase()}</p>
              <p className="tabular text-lg font-semibold">{pct(scenario.share, 0)}</p>
              <p className="text-xs text-muted-foreground">da diferença observada é recuperada</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">É uma premissa de potencial, não um resultado medido nem garantido.</strong> Supõe que uma ação leve — exposição conjunta, uma mensagem, um novo posicionamento — recupera só
          parte da diferença que os dados mostram hoje. Será calibrada com o que os testes realmente entregarem.
        </p>
        <dl className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Margem observada</dt>
            <dd>R$ X</dd>
            <ProvenanceBadge provenance="derived" />
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Impacto potencial estimado</dt>
            <dd>R$ Y–Z</dd>
            <ProvenanceBadge provenance="estimate" />
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Confiança</dt>
            <dd>média</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ parameters, scopeEmpty, scopeLabel, comparisonRequested, current, previous, costs, afterLoss }: OverviewProps) {
  if (scopeEmpty) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">Sem detalhe de transação para {scopeLabel} neste período</p>
        <p className="max-w-xl text-sm text-muted-foreground">
          Nenhuma linha concluída chegou para este escopo, então não há o que somar — e mostrar zeros diria que nada foi vendido. Escolha outra loja, a rede ou outro período.
        </p>
      </div>
    );
  }

  const compared = comparisonRequested && previous !== null;
  const delta = (now: number | null, before: number | null | undefined): KpiDelta => ({ compared, pct: compared ? relativeDelta(now, before ?? null) : null });

  const unresolved = current.margin.unresolvedSkuCount;
  const unresolvedWarning =
    unresolved > 0
      ? `${unresolved} ${unresolved === 1 ? "produto sem custo resolvido foi excluído" : "produtos sem custo resolvido foram excluídos"} da margem (${pct(current.margin.unresolvedRevenueShare)} da receita).`
      : undefined;
  const marginState = stateForCosts(costs, current.margin.marginCents);

  // Margem após perdas: own state, because it can be missing for reasons the other margins are not.
  const loss = afterLoss.current;
  let lossState: KpiState = { kind: "value" };
  if (afterLoss.status === "loading") lossState = { kind: "loading" };
  else if (afterLoss.status === "no_permission") lossState = { kind: "unavailable", reason: "Sem permissão" };
  else if (afterLoss.status === "error") lossState = { kind: "unavailable", reason: "Indisponível" };
  else if (marginState.kind !== "value" && marginState.kind !== "loading") lossState = { kind: "unavailable", reason: "Depende do custo dos produtos" };
  else if (loss.valueCents === null) lossState = { kind: "unavailable", reason: "Sem reconciliação do período" };

  const partial = loss.coveredStores < loss.totalStores;
  const lossNote = partial
    ? `sobre ${loss.coveredStores} de ${loss.totalStores} lojas`
    : loss.incompleteStores > 0
      ? `reconciliação incompleta em ${loss.incompleteStores} de ${loss.coveredStores} lojas`
      : `sobre ${loss.coveredStores} ${loss.coveredStores === 1 ? "loja" : "lojas"}`;
  const lossWarning =
    loss.incompleteStores > 0 && partial
      ? `A reconciliação está incompleta em ${loss.incompleteStores} das lojas cobertas (estoque inconsistente ou produto sem custo); a perda dessas lojas é a registrada, com essa ressalva.`
      : loss.incompleteStores > 0
        ? "A reconciliação está incompleta (estoque inconsistente ou produto sem custo); a perda é a registrada, com essa ressalva."
        : undefined;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Indicadores" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Receita" value={money(current.revenueCents)} provenance="fact" delta={delta(current.revenueCents, previous?.revenueCents)} note={`${count(current.basketCount)} compras`} />
        <KpiCard label="Ticket médio" value={money(current.ticketCents === null ? null : Math.round(current.ticketCents))} provenance="derived" delta={delta(current.ticketCents, previous?.ticketCents)} />
        <KpiCard label="Itens por compra" value={decimal(current.itemsPerBasket)} provenance="derived" delta={delta(current.itemsPerBasket, previous?.itemsPerBasket)} />
        <KpiCard
          label="Margem por compra"
          value={money(current.marginPerBasketCents === null ? null : Math.round(current.marginPerBasketCents))}
          provenance="derived"
          state={marginState}
          delta={delta(current.marginPerBasketCents, previous?.marginPerBasketCents)}
          note={current.marginBasketCount > 0 ? `sobre ${count(current.marginBasketCount)} compras com custo` : undefined}
          warning={unresolvedWarning}
        />
        <KpiCard
          label="Margem total"
          value={money(current.margin.marginCents)}
          provenance="derived"
          state={marginState}
          delta={delta(current.margin.marginCents, previous?.margin.marginCents)}
          note={current.margin.marginPct !== null ? `${pct(current.margin.marginPct)} da receita com custo` : undefined}
          warning={unresolvedWarning}
        />
        <KpiCard
          label="Margem após perdas"
          value={money(loss.valueCents)}
          provenance="derived"
          state={lossState}
          delta={delta(loss.valueCents, afterLoss.previous?.valueCents)}
          note={lossNote}
          warning={lossWarning}
        />
        <KpiCard
          label="Oportunidades identificadas"
          value="—"
          provenance="estimate"
          state={{ kind: "unavailable", reason: "Em espera: as recomendações só começam depois de importados os meses reais e calibrados os parâmetros." }}
        />
      </section>

      <ImpactEstimateCard parameters={parameters} />

      <Card>
        <CardHeader>
          <CardTitle>Central de oportunidades</CardTitle>
          <CardDescription>
            Aqui vão aparecer poucas oportunidades — hoje {parameters.impact.mainScreenItems} na tela principal, as demais sob demanda —, ordenadas por impacto potencial, confiança, esforço e risco à
            margem, cada uma com a evidência, o período, o benchmark, a amostra e as limitações. Quando não houver evidência suficiente, a resposta será exatamente essa: “não há evidência suficiente para
            recomendar uma ação”. Ficam em espera de propósito: os limiares que as decidem ainda são provisórios e serão calibrados com os meses reais importados do Drive.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>O que ainda não sabemos</CardTitle>
          <CardDescription>Limites permanentes dos dados de hoje — valem para tudo nesta página.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {STANDING_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
