"use client";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CommercialParameters } from "@/lib/commercial-intelligence/parameters";
import type { BiasDiagnostic, CouponGate, DistributionComparison, GateState } from "@/lib/commercial-intelligence/quality";
import { count, money } from "@/lib/format";
import { categoryLabel } from "@/lib/sales-insights";
import { pct } from "./format";
import { HeldTab } from "./held-tab";
import { ProvenanceBadge } from "./provenance-badge";

const GATE: Record<GateState, { label: string; tone: StatusTone; meaning: string }> = {
  open: { label: "Aberta", tone: "positive", meaning: "As análises de cesta rodam em todas as lojas, sem teto de confiança." },
  partial: { label: "Parcial", tone: "attention", meaning: "As análises de cesta rodam só nas lojas elegíveis e as recomendações ficam limitadas a confiança Média." },
  blocked: { label: "Bloqueada", tone: "critical", meaning: "Não há pares de produtos nem “o que falta no carrinho” até que o cupom cubra o suficiente." },
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** The coverage of one store on a 0–100% track, with the two thresholds drawn as reference lines. */
function CoverageBar({ value, eligible, exclusion, full }: { value: number; eligible: boolean; exclusion: number; full: number }) {
  const fill = !eligible ? "bg-destructive" : value >= full ? "bg-success" : "bg-warning";
  return (
    <div
      className="relative h-2 w-44 rounded-full bg-muted"
      role="img"
      aria-label={`Cobertura de ${pct(value)}; limite de exclusão em ${pct(exclusion, 0)} e de abertura em ${pct(full, 0)}`}
    >
      <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
      <div className="absolute -inset-y-1 w-px bg-foreground/70" style={{ left: `${exclusion * 100}%` }} aria-hidden />
      <div className="absolute -inset-y-1 w-px bg-foreground/70" style={{ left: `${full * 100}%` }} aria-hidden />
    </div>
  );
}

function HowItIsComputed({ p }: { p: CommercialParameters }) {
  const c = p.coupon;
  return (
    <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Como cada número é calculado e o que ele decide</summary>
      <div className="mt-2 flex flex-col gap-2 text-muted-foreground">
        <p>
          <strong className="text-foreground">Cobertura da loja</strong> = linhas concluídas <em>com cupom</em> ÷ todas as linhas concluídas da loja no período. Uma linha é um produto de uma
          transação; tentativas recusadas ou canceladas ficam fora dos dois lados.
        </p>
        <p>
          <strong className="text-foreground">Cobertura da rede</strong> = soma das linhas com cupom ÷ soma das linhas concluídas, de todas as lojas com detalhe. É agregada: uma loja grande
          pesa mais, não é a média dos percentuais.
        </p>
        <p>
          <strong className="text-foreground">Cobertura em receita</strong> = valor pago nas linhas com cupom ÷ valor pago em todas as linhas concluídas. É só informativa e não decide nada.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Loja abaixo de {pct(c.exclusionCoverage, 0)}: sai das análises de cesta e aparece como excluída, com o seu número.</li>
          <li>Rede a partir de {pct(c.fullCoverage, 0)} e nenhuma loja excluída: <strong className="text-foreground">Aberta</strong>.</li>
          <li>Rede entre {pct(c.exclusionCoverage, 0)} e {pct(c.fullCoverage, 0)}, ou alguma loja excluída: <strong className="text-foreground">Parcial</strong> — só as lojas elegíveis, confiança de cesta no máximo Média.</li>
          <li>
            Menos de {count(c.eligibleBasketsMinNetwork)} compras com cupom nas lojas elegíveis, ou menos de {pct(c.multiItemShareMin, 0)} delas com 2 ou mais produtos:{" "}
            <strong className="text-foreground">Bloqueada</strong>.
          </li>
          <li>Um cupom cujas linhas se espalham por mais de {c.spanMaxMinutes} minutos é tratado como reaproveitado: a cesta sai e é contada.</li>
        </ul>
        <p>Os limites acima são critérios de qualidade provisórios, ainda não calibrados com dados reais. Ficam em Configurações avançadas / calibração; não são ajustes desta tela.</p>
      </div>
    </details>
  );
}

function GateCard({ gate, p }: { gate: CouponGate; p: CommercialParameters }) {
  const state = GATE[gate.state];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Cobertura de cupom
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          <ProvenanceBadge provenance="derived" />
        </CardTitle>
        <CardDescription>{state.meaning}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Cobertura da rede" value={pct(gate.networkCoverage)} hint="linhas com cupom ÷ linhas" />
          <Stat label="Cobertura em receita" value={pct(gate.networkRevenueCoverage)} hint="só informativa" />
          <Stat label="Compras elegíveis" value={count(gate.eligibleBaskets)} hint={`mínimo ${count(p.coupon.eligibleBasketsMinNetwork)}`} />
          <Stat label="Compras com 2+ produtos" value={pct(gate.multiItemShare)} hint={`mínimo ${pct(p.coupon.multiItemShareMin, 0)}`} />
          <Stat label="Linhas sem cupom" value={count(gate.orphanLines)} hint="nunca viram cesta" />
        </dl>

        {gate.reasons.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {gate.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {gate.unblock.length > 0 && (
          <div className="rounded-lg border border-dashed p-3 text-sm">
            <p className="font-medium">O que destrava</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              {gate.unblock.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}

        <HowItIsComputed p={p} />
      </CardContent>
    </Card>
  );
}

function StoresCard({ gate, p, storeName, selectedStoreId }: { gate: CouponGate; p: CommercialParameters; storeName: (id: number) => string; selectedStoreId: number | null }) {
  const rows = [...gate.stores].sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobertura por loja</CardTitle>
        <CardDescription>
          Da pior para a melhor. As duas linhas verticais marcam os limites em uso: {pct(p.coupon.exclusionCoverage, 0)} (abaixo dele a loja é excluída) e {pct(p.coupon.fullCoverage, 0)} (a
          partir dele, e sem loja excluída, a rede abre). Sempre sobre a rede inteira; a loja escolhida no filtro fica destacada.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead>Cobertura</TableHead>
              <TableHead className="text-right">Linhas com cupom</TableHead>
              <TableHead className="text-right">Compras com cupom</TableHead>
              <TableHead className="text-right">Com 2+ produtos</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.storeId} data-state={row.storeId === selectedStoreId ? "selected" : undefined}>
                <TableCell className="font-medium">{storeName(row.storeId)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <CoverageBar value={row.coverage ?? 0} eligible={row.eligible} exclusion={p.coupon.exclusionCoverage} full={p.coupon.fullCoverage} />
                    <span className="tabular w-14 text-sm">{pct(row.coverage)}</span>
                  </div>
                </TableCell>
                <TableCell className="tabular text-right">
                  {count(row.couponLines)} / {count(row.okLines)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {count(row.couponBaskets)}
                  {row.reusedBaskets > 0 && <span className="ml-1 text-xs text-muted-foreground">(+{row.reusedBaskets} reaproveitados)</span>}
                </TableCell>
                <TableCell className="tabular text-right">{pct(row.multiItemShare)}</TableCell>
                <TableCell>
                  <StatusBadge tone={row.eligible ? "positive" : "critical"}>{row.eligible ? "Elegível" : "Excluída"}</StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Two shares per bucket — with a coupon and without — and how far apart the two distributions are overall. */
function DistributionCard({ title, comparison, scroll = false }: { title: string; comparison: DistributionComparison; scroll?: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          {title}
          <span className="text-xs font-normal text-muted-foreground">diferença: {comparison.distance === null ? "—" : pct(comparison.distance)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {comparison.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem linhas para comparar.</p>
        ) : (
          <ul className={`flex flex-col gap-1.5 ${scroll ? "max-h-72 overflow-y-auto pr-1" : ""}`}>
            {comparison.rows.map((row) => (
              <li key={row.key} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs">
                <span className="truncate" title={row.label}>
                  {row.label}
                </span>
                <span className="flex flex-col gap-0.5" aria-hidden>
                  <span className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(row.coupon * 100, row.coupon > 0 ? 1 : 0)}%` }} />
                  <span className="h-1.5 rounded-full bg-muted-foreground/60" style={{ width: `${Math.max(row.noCoupon * 100, row.noCoupon > 0 ? 1 : 0)}%` }} />
                </span>
                <span className="tabular text-right text-muted-foreground">
                  {pct(row.coupon)} · {pct(row.noCoupon)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticCard({ diagnostic }: { diagnostic: BiasDiagnostic }) {
  return (
    <section className="flex flex-col gap-3" aria-label="Diagnóstico de viés do cupom">
      <div className="flex flex-col gap-1">
        <h2 className="flex flex-wrap items-center gap-2 text-base font-medium">
          Linhas com cupom × linhas sem cupom
          <ProvenanceBadge provenance="derived" />
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          O que falta de cupom só é inofensivo se faltar ao acaso. Aqui se compara o que as linhas sem cupom têm de diferente: o que compram, quanto valem, a que horas e em que máquina. Cada
          bloco traz a <em>diferença</em> entre as duas distribuições (0% = idênticas, 100% = sem nada em comum). Diferença grande em uma dimensão é sinal de que a falta de cupom tem padrão
          — por exemplo uma máquina que não imprime. <strong>Esta tela só mede; não recomenda nada</strong>, e alimenta a calibração dos limites.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border p-3 sm:grid-cols-4">
        <Stat label="Linhas com cupom" value={count(diagnostic.couponLines)} />
        <Stat label="Linhas sem cupom" value={count(diagnostic.noCouponLines)} />
        <Stat label="Valor médio da linha, com cupom" value={money(diagnostic.avgLineCents.coupon === null ? null : Math.round(diagnostic.avgLineCents.coupon))} />
        <Stat label="Valor médio da linha, sem cupom" value={money(diagnostic.avgLineCents.noCoupon === null ? null : Math.round(diagnostic.avgLineCents.noCoupon))} />
      </dl>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-4 rounded-full bg-primary" aria-hidden /> com cupom
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-4 rounded-full bg-muted-foreground/60" aria-hidden /> sem cupom
        </span>
        <span>Os números são a parcela das linhas de cada grupo: com cupom · sem cupom.</span>
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <DistributionCard
          title="Categoria do produto"
          comparison={{ ...diagnostic.category, rows: diagnostic.category.rows.map((row) => ({ ...row, label: categoryLabel(row.key) })) }}
        />
        <DistributionCard title="Hora do dia (relógio da loja)" comparison={diagnostic.hour} scroll />
        <DistributionCard title="Modelo da máquina" comparison={diagnostic.machineModel} />
        <DistributionCard title="PDV" comparison={diagnostic.pos} scroll />
      </div>
    </section>
  );
}

export function CombosTab({
  gate,
  diagnostic,
  parameters,
  storeName,
  selectedStoreId,
}: {
  gate: CouponGate;
  diagnostic: BiasDiagnostic;
  parameters: CommercialParameters;
  storeName: (id: number) => string;
  selectedStoreId: number | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <GateCard gate={gate} p={parameters} />
      <StoresCard gate={gate} p={parameters} storeName={storeName} selectedStoreId={selectedStoreId} />
      <DiagnosticCard diagnostic={diagnostic} />
      <HeldTab
        title="Pares de produtos, “o que falta no carrinho” e simulador de combo"
        what="Os pares que compram juntos, a lacuna de cada carrinho e a simulação de um combo com margem mínima."
        pointer={false}
      />
    </div>
  );
}
