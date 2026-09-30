"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AuditDistribution, BalanceAudit, IngestionGaps } from "@/lib/api/balance-audit";
import { count, date, period } from "@/lib/format";
import { decimal, pct } from "../format";

/** Turnover bands as the backend names them. `unknown` is "sales were never loaded", which is not "does not sell". */
const TURNOVER_LABEL: Record<string, string> = {
  high: "Giro alto",
  medium: "Giro médio",
  low: "Giro baixo",
  no_sales: "Sem venda no período",
  unknown: "Venda não importada",
};
const TURNOVER_ORDER = ["high", "medium", "low", "no_sales", "unknown"];

export function BalanceNotice() {
  return (
    <Card size="sm" role="note">
      <CardHeader>
        <CardTitle>Como ler esta tela</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Consumo entre visitas e vendas registradas vêm do mesmo ponto de venda.</strong> Quando os dois concordam, isso mostra que os dados estão
          alinhados entre si — não prova quanto existe fisicamente na prateleira.
        </p>
        <p>
          A contagem é a feita <strong className="text-foreground">antes</strong> do abastecimento e cobre só parte das linhas (mostrado ao lado de cada número). Esta tela apenas descreve as
          diferenças: nenhum limite de divergência foi definido e nada aqui altera recomendações, saldo estimado ou sugestão de abastecimento.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** One band per row: how many lines it covers, the share with no difference, the spread, and the count in each bin. */
function DistributionTable({
  caption,
  unit,
  rows,
  bins,
  zeroLabel,
}: {
  caption: string;
  unit: string;
  rows: { key: string; label: string; distribution: AuditDistribution }[];
  bins: string[];
  zeroLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Faixa</TableHead>
            <TableHead className="text-right">{unit}</TableHead>
            <TableHead className="text-right">{zeroLabel}</TableHead>
            <TableHead className="text-right">Mediana</TableHead>
            <TableHead className="text-right">P90</TableHead>
            <TableHead className="text-right">Máx.</TableHead>
            {bins.map((bin) => (
              <TableHead key={bin} className="text-right" title="Diferença absoluta, em unidades">
                {bin}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ key, label, distribution }) => (
            <TableRow key={key}>
              <TableCell className="font-medium">{label}</TableCell>
              <TableCell className="tabular text-right">{count(distribution.lines)}</TableCell>
              <TableCell className="tabular text-right">{pct(distribution.share_zero, 1)}</TableCell>
              <TableCell className="tabular text-right">{distribution.quantiles ? decimal(distribution.quantiles.p50) : "—"}</TableCell>
              <TableCell className="tabular text-right">{distribution.quantiles ? decimal(distribution.quantiles.p90) : "—"}</TableCell>
              <TableCell className="tabular text-right">{distribution.quantiles ? decimal(distribution.quantiles.max) : "—"}</TableCell>
              {distribution.absolute_bins.map((bin) => (
                <TableCell key={bin.label} className="tabular text-right">
                  {count(bin.lines)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function turnoverRows(byTurnover: Record<string, AuditDistribution>) {
  return TURNOVER_ORDER.filter((key) => byTurnover[key]).map((key) => ({ key, label: TURNOVER_LABEL[key] ?? key, distribution: byTurnover[key] }));
}

export function BalanceQualityView({
  audit,
  gaps,
  gapsError,
  storeName,
}: {
  audit: BalanceAudit;
  gaps: IngestionGaps | undefined;
  gapsError?: boolean;
  storeName: (storeId: number) => string;
}) {
  const { covered, presentation, count_vs_system: counts, consumption_vs_sales: consumption, count_coverage: coverage } = audit;
  const absoluteBins = presentation.absolute_bins;

  return (
    <div className="flex flex-col gap-4">
      <BalanceNotice />

      <Card size="sm">
        <CardHeader>
          <CardTitle>O que os dados cobrem</CardTitle>
          <CardDescription>
            Período auditado: {period(audit.range.from)} a {period(audit.range.to)}. Visitas de {date(covered.first_visit_end)} a {date(covered.last_visit_end)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Lojas com visita" value={count(covered.stores)} />
            <Stat label="Visitas" value={count(covered.visits)} />
            <Stat label="Linhas de visita" value={count(covered.lines)} />
            <Stat
              label="Linhas contadas"
              value={count(counts.lines_counted)}
              hint={`${count(counts.lines_uncounted)} sem contagem, fora da comparação (${pct(covered.lines === 0 ? null : counts.lines_counted / covered.lines, 1)} contadas)`}
            />
          </dl>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Contagem × saldo do sistema</CardTitle>
          <CardDescription>
            Cada linha contada compara a contagem feita antes do abastecimento com o saldo que o sistema tinha. {count(counts.overall.lines)} linhas neste período.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <DistributionTable
            caption="Contagem contra saldo do sistema, todas as linhas contadas"
            unit="Linhas"
            zeroLabel="Iguais"
            bins={absoluteBins}
            rows={[{ key: "all", label: "Todas as linhas contadas", distribution: counts.overall }]}
          />
          <p className="text-xs text-muted-foreground">Colunas à direita: quantas linhas caem em cada diferença absoluta, em unidades.</p>
          <div>
            <h3 className="mb-1 text-sm font-medium">Por giro da loja × SKU</h3>
            <DistributionTable caption="Contagem contra sistema por faixa de giro" unit="Linhas" zeroLabel="Iguais" bins={absoluteBins} rows={turnoverRows(counts.by_turnover)} />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Por faixa de saldo do sistema antes da visita</h3>
            <DistributionTable
              caption="Contagem contra sistema por faixa de saldo"
              unit="Linhas"
              zeroLabel="Iguais"
              bins={absoluteBins}
              rows={presentation.balance_bands.filter((band) => counts.by_balance[band]).map((band) => ({ key: band, label: `Saldo ${band}`, distribution: counts.by_balance[band] }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Faixas provisórias, só para fatiar os números: giro alto a partir de {presentation.turnover.high_min} un/mês, médio a partir de {presentation.turnover.medium_min}. O giro é a média
            mensal vendida pela loja naquele SKU nos meses com venda importada.
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Cobertura da contagem</CardTitle>
          <CardDescription>
            Quanto do estoque as contagens representam, por loja e mês. A parcela é sobre as linhas com saldo positivo no sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-auto">
            <Table>
              <caption className="sr-only">Cobertura da contagem por loja e mês</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Operações</TableHead>
                  <TableHead className="text-right">Com contagem</TableHead>
                  <TableHead className="text-right">Linhas</TableHead>
                  <TableHead className="text-right">Contadas</TableHead>
                  <TableHead className="text-right">Linhas com saldo &gt; 0 contadas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.map((row) => (
                  <TableRow key={`${row.store_id}-${row.month}`}>
                    <TableCell>{storeName(row.store_id)}</TableCell>
                    <TableCell>{period(row.month)}</TableCell>
                    <TableCell className="tabular text-right">{count(row.operations)}</TableCell>
                    <TableCell className="tabular text-right">{count(row.operations_with_count)}</TableCell>
                    <TableCell className="tabular text-right">{count(row.lines)}</TableCell>
                    <TableCell className="tabular text-right">{count(row.counted_lines)}</TableCell>
                    <TableCell className="tabular text-right">
                      {pct(row.share_positive_balance_counted, 0)} ({count(row.counted_positive_balance_lines)} de {count(row.positive_balance_lines)})
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Consumo entre visitas × vendas registradas</CardTitle>
          <CardDescription>
            Consumo = saldo depois de uma visita menos o saldo antes da próxima, repartido pelos dias de cada mês. Só entram meses inteiramente cobertos pelas visitas.{" "}
            {count(consumption.compared_sku_months)} combinações loja × SKU × mês comparadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <DistributionTable
            caption="Consumo contra venda, todas as combinações comparadas"
            unit="Loja × SKU × mês"
            zeroLabel="Sem diferença"
            bins={absoluteBins}
            rows={[{ key: "all", label: "Todas as combinações", distribution: consumption.overall }]}
          />
          <div>
            <h3 className="mb-1 text-sm font-medium">Por giro da loja × SKU</h3>
            <DistributionTable caption="Consumo contra venda por faixa de giro" unit="Loja × SKU × mês" zeroLabel="Sem diferença" bins={absoluteBins} rows={turnoverRows(consumption.by_turnover)} />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium">Razão consumo ÷ venda por loja e mês</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Mediana das razões: {consumption.median_ratio === null ? "—" : decimal(consumption.median_ratio)} (sobre {count(consumption.store_months.length)} lojas-mês).
            </p>
            <div className="max-h-96 overflow-auto">
              <Table>
                <caption className="sr-only">Razão entre consumo e venda por loja e mês</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loja</TableHead>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Loja × SKU comparados</TableHead>
                    <TableHead className="text-right">Consumo (un.)</TableHead>
                    <TableHead className="text-right">Venda (un.)</TableHead>
                    <TableHead className="text-right">Consumo ÷ venda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumption.store_months.map((row) => (
                    <TableRow key={`${row.store_id}-${row.month}`}>
                      <TableCell>{storeName(row.store_id)}</TableCell>
                      <TableCell>{period(row.month)}</TableCell>
                      <TableCell className="tabular text-right">{count(row.sku_months)}</TableCell>
                      <TableCell className="tabular text-right">{decimal(row.consumption_units)}</TableCell>
                      <TableCell className="tabular text-right">{count(row.sales_units)}</TableCell>
                      <TableCell className="tabular text-right">{row.ratio === null ? "—" : decimal(row.ratio)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <GapsCard audit={audit} gaps={gaps} gapsError={gapsError} storeName={storeName} />
    </div>
  );
}

function GapsCard({
  audit,
  gaps,
  gapsError,
  storeName,
}: {
  audit: BalanceAudit;
  gaps: IngestionGaps | undefined;
  gapsError?: boolean;
  storeName: (storeId: number) => string;
}) {
  const { store_months_without_sales: noSales, balance_rises_without_event: rises, capacity, unavailable_stores: unavailable } = audit.gaps;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Lacunas nos dados</CardTitle>
        <CardDescription>O que faltou ou ficou de fora, ao lado dos números acima.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <section>
          <h3 className="font-medium">Lojas-mês com consumo e sem venda importada</h3>
          {noSales.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma no período.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Listadas e fora das distribuições de consumo × venda — uma venda não importada não é uma diferença grande.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {noSales.map((row) => (
                  <li key={`${row.store_id}-${row.month}`}>
                    {storeName(row.store_id)}, {period(row.month)}: {decimal(row.consumption_units)} un. de consumo em {count(row.sku_months)} loja × SKU
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section>
          <h3 className="font-medium">Saldo que subiu entre visitas sem evento registrado</h3>
          <p className="text-muted-foreground">
            {count(rises.pairs)} pares de visitas ({count(rises.units)} un. no total). Não são tratados como consumo negativo; {count(rises.sku_months_excluded)} loja × SKU × mês ficaram fora da
            comparação por causa deles.
          </p>
        </section>

        <section>
          <h3 className="font-medium">Capacidade de prateleira</h3>
          <p className="text-muted-foreground">
            {capacity.available
              ? `${pct(capacity.share_with_capacity, 1)} das linhas (${count(capacity.lines_with_capacity)} de ${count(capacity.lines)}) informam capacidade.`
              : `Não disponível: nenhuma das ${count(capacity.lines)} linhas informa capacidade.`}
          </p>
        </section>

        <section>
          <h3 className="font-medium">Operações sem cliente (estoque do centro de distribuição)</h3>
          {gapsError ? (
            <p className="text-muted-foreground">Não foi possível carregar esta contagem agora.</p>
          ) : !gaps ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {count(gaps.totals.operationsWithoutClient)} operações e {count(gaps.totals.linesWithoutClient)} linhas ficaram de fora por não nomearem loja. Não foram gravadas em nenhuma
                loja.
              </p>
              {gaps.periods.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {gaps.periods.map((row) => (
                    <li key={row.period}>
                      {period(row.period)}: {count(row.operationsWithoutClient)} operações, {count(row.linesWithoutClient)} linhas
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {unavailable.length > 0 && (
          <section>
            <h3 className="font-medium">Lojas que não puderam ser lidas</h3>
            <p className="text-xs text-muted-foreground">Ficaram fora de todos os números acima — não entraram como zero.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {unavailable.map((row) => (
                <li key={row.store_id}>{storeName(row.store_id)}</li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
