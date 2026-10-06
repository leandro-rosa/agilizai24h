import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { date, period as fmtPeriod } from "@/lib/format";
import { reasonLabel } from "@/lib/removal-reasons";
import { BEHAVIOR_LABELS } from "../product-behavior";
import { signedPct, signedPp, type RateDelta, type ValueDelta } from "../compare";
import { monthName } from "../reading";
import { baseText } from "../ranking";
import { SIGNAL_LABELS, TESTS } from "../tests";
import type { CashUseLine, KpiResult, LossChange, Overview, ProductRow, StoreExplainers } from "../types";

export interface ReportMeta {
  version: number;
  generatedAt: string;
  baseAt: string;
}

/** Helvetica padrão não tem "−", setas nem "≥": troca por equivalentes seguros em vez de exibir lixo. */
const t = (s: string) => s.replace(/−/g, "-").replace(/[↑↓→]/g, "").replace(/≥/g, ">=").replace(/…/g, "...");
const brl = (c: number | null | undefined) =>
  c === null || c === undefined ? "-" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(c / 100);
const pct = (v: number | null, d = 1) => (v === null ? "-" : `${(v * 100).toFixed(d).replace(".", ",")}%`);

const C = { ink: "#1a1a1a", muted: "#666", line: "#d9d9d9", brand: "#c2185b", good: "#1d7349", bad: "#c70500", soft: "#f6f3f5" };
const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: C.ink },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: C.brand, paddingBottom: 8, marginBottom: 10 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9, color: C.muted, marginTop: 2 },
  meta: { fontSize: 8, color: C.muted, textAlign: "right" },
  row: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 8, marginBottom: 10 },
  h2: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 5, color: C.brand },
  kpi: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 4, padding: 7, backgroundColor: C.soft },
  kpiLabel: { fontSize: 7.5, color: C.muted },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginVertical: 2 },
  small: { fontSize: 7.5, color: C.muted },
  line: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 2, marginBottom: 2 },
  footer: { position: "absolute", bottom: 14, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: C.muted },
});

const num = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);

function Kpi({ k, prev }: { k: KpiResult; prev: string }) {
  const rate = k.kind === "rate";
  const p = rate ? (k.vsPrevious as RateDelta).pp : (k.vsPrevious as ValueDelta).pct;
  const a = rate ? (k.vsAvg3 as RateDelta).pp : (k.vsAvg3 as ValueDelta).pct;
  const fmt = (v: number | null) => (rate ? signedPp(v) : signedPct(v));
  const color = (v: number | null) => (v === null || v === 0 ? C.muted : (v > 0) === k.goodWhenUp ? C.good : C.bad);
  const show = (v: number | null) => (v === null ? "sem dados" : rate ? pct(v) : brl(v));
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLabel}>{k.label}</Text>
      <Text style={s.kpiValue}>{k.value === null ? "Sem dados" : show(k.value)}</Text>
      <Text style={{ fontSize: 7.5, color: color(p) }}>{t(fmt(p))} vs. {fmtPeriod(prev)}</Text>
      <Text style={s.small}>{fmtPeriod(prev)}: {show(k.previous)}</Text>
      <Text style={{ fontSize: 7.5, color: color(a) }}>{t(fmt(a))} vs. media 3 meses</Text>
      <Text style={[s.small, { marginTop: 2 }]}>{t(k.note)}</Text>
    </View>
  );
}

/** Resumo executivo: 5 colunas. A analise por loja fica na tela, nao no PDF. */
function ProductTable({ rows }: { rows: ProductRow[] }) {
  return (
    <View>
      <View style={s.th}>
        <Text style={[{ flex: 3 }, s.bold]}>Produto</Text>
        <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Unid.</Text>
        <Text style={[{ flex: 1.4, textAlign: "right" }, s.bold]}>Receita</Text>
        <Text style={[{ flex: 2, textAlign: "right" }, s.bold]}>vs. mes anterior</Text>
        <Text style={[{ flex: 2.2, textAlign: "right" }, s.bold]}>Tendencia</Text>
      </View>
      {rows.slice(0, 5).map((r) => (
        <View key={r.sku} style={s.line} wrap={false}>
          <Text style={{ flex: 3 }}>{t(r.name)}</Text>
          <Text style={{ flex: 1, textAlign: "right" }}>{num(r.units)}</Text>
          <Text style={{ flex: 1.4, textAlign: "right" }}>{brl(r.revenueCents)}</Text>
          <Text style={{ flex: 2, textAlign: "right" }}>
            {r.unitsPrevious === null ? "sem base" : `${r.deltaUnitsPct === null ? "novo no mes" : t(signedPct(r.deltaUnitsPct, 0))} (${t(baseText(r.unitsPrevious, r.units, num, "un."))})`}
          </Text>
          <Text style={{ flex: 2.2, textAlign: "right" }}>{t(BEHAVIOR_LABELS[r.behavior])}</Text>
        </View>
      ))}
    </View>
  );
}

function Use({ l, prev }: { l: CashUseLine; prev: string }) {
  return (
    <View style={s.line} wrap={false}>
      <Text>{t(l.label)}</Text>
      <Text>
        {l.previousCents === null ? `${brl(l.currentCents)}  sem base no mes anterior` : `${t(baseText(l.previousCents, l.currentCents, (n) => brl(n), ""))}  vs. ${fmtPeriod(prev)}`}
        {l.shareOfOutflow !== null ? `  ${pct(l.shareOfOutflow, 0)} das saidas` : ""}
      </Text>
    </View>
  );
}

function Explainers({ title, e, sign }: { title: string; e: StoreExplainers; sign: "+" | "-" }) {
  return (
    <View style={s.col}>
      <Text style={[s.small, s.bold]}>{title}</Text>
      {e.stores.length === 0 ? <Text style={s.small}>Nenhuma loja.</Text> : (
        <>
          <Text style={s.small}>{e.stores.length} de {e.storeCount} lojas explicam {Math.round(e.coveredShare * 100)}% ({brl(e.totalCents)})</Text>
          {e.stores.map((x) => (
            <View key={x.storeId} style={s.line} wrap={false}>
              <Text>{t(x.name)}</Text>
              <Text>{sign}{brl(Math.abs(x.deltaCents))}  {Math.round(x.share * 100)}%  ({brl(x.previousCents)} {"->"} {brl(x.currentCents)})</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function LossList({ title, rows, reason }: { title: string; rows: LossChange[]; reason?: boolean }) {
  return (
    <View style={s.col}>
      <Text style={[s.small, s.bold]}>{title}</Text>
      {rows.length === 0 ? <Text style={s.small}>Sem variacao relevante.</Text> : rows.map((c) => (
        <View key={c.label} style={s.line} wrap={false}>
          <Text>{t(reason ? reasonLabel(c.label) : c.label)}</Text>
          <Text>{c.deltaCents > 0 ? "+" : "-"}{brl(Math.abs(c.deltaCents))}  ({brl(c.previousCents)} {"->"} {brl(c.currentCents)})</Text>
        </View>
      ))}
    </View>
  );
}

const Unavail = ({ what }: { what: string }) => <Text style={{ color: C.bad }}>Indisponivel - {t(what)}</Text>;

function Footer({ o, meta }: { o: Overview; meta: ReportMeta }) {
  return (
    <View style={s.footer} fixed>
      <Text>Agiliz.ai - Resumo Executivo Mensal - {fmtPeriod(o.period)} - versao {meta.version}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
    </View>
  );
}

function Header({ o, meta }: { o: Overview; meta: ReportMeta }) {
  return (
    <View style={s.header}>
      <View>
        <Text style={s.title}>Resumo Executivo Mensal - Agiliz.ai</Text>
        <Text style={s.sub}>Competencia {t(monthName(o.period))} - comparacoes: vs. mes anterior e vs. media dos 3 meses anteriores</Text>
      </View>
      <View>
        <Text style={s.meta}>Ultimo fechamento do mes: {date(o.closedAt)}</Text>
        <Text style={s.meta}>Base do DRE: {date(meta.baseAt)} - Gerado em: {new Date(meta.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</Text>
        <Text style={s.meta}>Resumo {fmtPeriod(o.period)} - Versao {meta.version}</Text>
      </View>
    </View>
  );
}

export function MonthlyReport({ o, meta }: { o: Overview; meta: ReportMeta }) {
  const prev = o.previousPeriod;
  const hl = [
    { label: "Produto destaque", h: o.highlights.product },
    { label: "Maior crescimento", h: o.highlights.growth },
    { label: "Maior ponto de atencao", h: o.highlights.attention },
  ];
  return (
    <Document title={`Resumo Mensal Agiliz ${o.period}`} author="Agiliz.ai">
      {/* Pagina 1 - Como foi o mes? O que mudou? */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={[s.row, { marginBottom: 10 }]}>{o.kpis.map((k) => <Kpi key={k.key} k={k} prev={prev} />)}</View>
        <View style={s.card}>
          <Text style={s.h2}>Destaques do mes</Text>
          <View style={s.row}>
            {hl.map(({ label, h }) => (
              <View key={label} style={s.col}>
                <Text style={[s.small, s.bold]}>{label}</Text>
                {h ? (<><Text style={s.bold}>{t(h.title)}</Text><Text style={{ color: C.muted }}>{t(h.detail)}</Text></>) : <Text style={s.small}>Sem dados suficientes.</Text>}
              </View>
            ))}
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.h2}>O que mudou neste mes</Text>
          {o.insights.length === 0 ? <Text style={s.small}>Nenhuma variacao material com os dados disponiveis.</Text> : o.insights.map((i, n) => (
            <View key={i.id} style={{ marginBottom: 4 }} wrap={false}>
              <Text style={s.bold}>{n + 1}. {t(i.title)}</Text>
              <Text style={{ color: C.muted }}>{t(i.detail)}</Text>
            </View>
          ))}
          <Text style={s.small}>Ordenado por relevancia (impacto financeiro, representatividade, recorrencia e lojas afetadas), nao pelo tamanho do percentual.</Text>
        </View>
        <Footer o={o} meta={meta} />
      </Page>

      {/* Pagina 2 - Onde aconteceu? */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={s.card}>
          <Text style={s.h2}>Resumo da rede</Text>
          {!o.stores ? <Text style={s.small}>Sem dados - DRE por loja.</Text> : (
            <>
              <Text>{o.stores.compared} lojas comparadas: {o.stores.up} cresceram, {o.stores.down} recuaram, {o.stores.stable} estaveis. Base: {o.stores.basis === "vendas" ? "vendas de cada loja" : "receita liquida por loja do DRE"}.</Text>
              <View style={[s.row, { marginTop: 5 }]}>
                <Explainers title="Quem explicou o crescimento" e={o.stores.growthExplainers} sign="+" />
                <Explainers title="Quem explicou a queda" e={o.stores.declineExplainers} sign="-" />
              </View>
            </>
          )}
        </View>
        <View style={s.card}>
          <Text style={s.h2}>Produtos - desempenho do mes</Text>
          {!o.products ? <Text style={s.small}>Sem dados - vendas do mes nao importadas.</Text> : (
            <View style={s.row}>
              <View style={s.col}><Text style={[s.bold, { marginBottom: 3 }]}>Mais vendidos</Text><ProductTable rows={o.products.topSold} /></View>
              <View style={s.col}>
                <Text style={[s.bold, { marginBottom: 3 }]}>Em alta</Text>
                {o.products.rising.length ? <ProductTable rows={o.products.rising.slice(0, 3)} /> : <Text style={s.small}>Nenhum produto com alta material.</Text>}
                <Text style={[s.bold, { marginVertical: 3 }]}>Em queda</Text>
                {o.products.falling.length ? <ProductTable rows={o.products.falling.slice(0, 3)} /> : <Text style={s.small}>Nenhum produto com queda material.</Text>}
              </View>
            </View>
          )}
          <Text style={[s.small, { marginTop: 4 }]}>A analise por loja de cada produto esta na tela (Visao geral, clique no produto).</Text>
        </View>
        <View style={s.card}>
          <Text style={s.h2}>Produtos em teste</Text>
          {!o.tests ? <Unavail what="abastecimento" /> : o.tests.rows.length === 0 ? (
            <Text style={s.small}>Nenhum SKU com primeiro abastecimento nos ultimos {TESTS.WINDOW_MONTHS} meses.</Text>
          ) : (
            <View>
              <View style={s.th}>
                <Text style={[{ flex: 3 }, s.bold]}>Produto</Text>
                <Text style={[{ flex: 1.4, textAlign: "right" }, s.bold]}>Lojas testadas</Text>
                <Text style={[{ flex: 1.6, textAlign: "right" }, s.bold]}>Cobertura</Text>
                <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Unid.</Text>
                <Text style={[{ flex: 1.2, textAlign: "right" }, s.bold]}>Perdas</Text>
                <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Margem</Text>
                <Text style={[{ flex: 1.8, textAlign: "right" }, s.bold]}>Tempo de teste</Text>
                <Text style={[{ flex: 1.6, textAlign: "right" }, s.bold]}>Sinal</Text>
              </View>
              {o.tests.rows.slice(0, 8).map((r) => (
                <View key={r.sku} style={s.line} wrap={false}>
                  <Text style={{ flex: 3 }}>{t(r.name)}</Text>
                  <Text style={{ flex: 1.4, textAlign: "right" }}>{r.storesRestocked}</Text>
                  <Text style={{ flex: 1.6, textAlign: "right" }}>{o.stores?.activeCount ? `${r.storesRestocked} de ${o.stores.activeCount}` : "-"} (vendeu em {r.storesSold})</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{num(r.unitsSold)}</Text>
                  <Text style={{ flex: 1.2, textAlign: "right" }}>{r.lossCents === null ? "-" : brl(r.lossCents)}</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{pct(r.marginPct, 0)}</Text>
                  <Text style={{ flex: 1.8, textAlign: "right" }}>{r.monthsInTest} {r.monthsInTest === 1 ? "mes" : "meses"} (desde {fmtPeriod(r.firstPeriod)})</Text>
                  <Text style={{ flex: 1.6, textAlign: "right" }}>{t(SIGNAL_LABELS[r.signal])}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[s.small, { marginTop: 4 }]}>Lista derivada do abastecimento (regra provisoria). Sinal e evidencia, nao decisao.</Text>
        </View>
        <Footer o={o} meta={meta} />
      </Page>

      {/* Pagina 3 - Por que merece atencao? (perdas e financeiro) */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={s.row}>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>Abastecimento e perdas</Text>
            {!o.loss ? <Text style={s.small}>Sem dados - nenhuma loja reconciliada no mes.</Text> : (
              <>
                <View style={s.line}><Text>Total abastecido (custo)</Text><Text style={s.bold}>{brl(o.loss.restockedCents)}</Text></View>
                <View style={s.line}><Text>Perdas (R$)</Text><Text style={s.bold}>{brl(o.loss.lossCents)}</Text></View>
                <View style={s.line}><Text>Perda / receita liquida</Text><Text style={s.bold}>{pct(o.loss.lossToRevenue)}</Text></View>
                <View style={s.line}><Text>Perda / custo abastecido</Text><Text style={s.bold}>{pct(o.loss.lossToSupplied)}</Text></View>
                {o.loss.incompleteStores > 0 && <Text style={[s.small, { color: C.bad }]}>{o.loss.incompleteStores} loja(s) com reconciliacao incompleta - valores podem estar subestimados.</Text>}
                <Text style={[s.small, s.bold, { marginTop: 6 }]}>O que mudou nas perdas</Text>
                {!o.loss.changes ? <Text style={s.small}>Sem perdas do mes anterior para comparar.</Text> : (
                  <>
                    <Text>{brl(o.loss.changes.totalPreviousCents)} {"->"} {brl(o.loss.changes.totalCurrentCents)}</Text>
                    <LossList title="Motivos que mais mudaram" rows={o.loss.changes.byReason.slice(0, 3)} reason />
                    <LossList title="Produtos que mais mudaram" rows={o.loss.changes.bySku.slice(0, 3)} />
                  </>
                )}
              </>
            )}
          </View>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>Financeiro e caixa</Text>
            {o.cash.closing === null ? <Text style={s.small}>Sem dados - fluxo de caixa da tesouraria.</Text> : (
              <>
                <View style={s.line}><Text>Saldo inicial</Text><Text style={s.bold}>{brl(o.cash.opening)}</Text></View>
                <View style={s.line}><Text>Entradas</Text><Text style={s.bold}>{brl(o.cash.inflow)}</Text></View>
                <View style={s.line}><Text>Saidas</Text><Text style={s.bold}>{brl(o.cash.outflow)}</Text></View>
                <View style={s.line}><Text>Saldo final</Text><Text style={s.bold}>{brl(o.cash.closing)}</Text></View>
                {o.cash.operatingPositiveCashFell && o.cash.cashDeltaCents !== null && <Text style={{ marginTop: 3 }}>Observacao: resultado operacional positivo e caixa {brl(Math.abs(o.cash.cashDeltaCents))} menor no mes.</Text>}
              </>
            )}
            <View style={[s.line, { marginTop: 5 }]}><Text>A receber vencido{o.cash.agingReference ? ` (em ${date(o.cash.agingReference)})` : ""}</Text><Text style={s.bold}>{o.cash.overdueCents === null ? "sem dados" : brl(o.cash.overdueCents)}</Text></View>
          </View>
        </View>
        <View style={s.row}>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>Principais movimentos financeiros</Text>
            {!o.cashUses ? <Text style={s.small}>Sem lancamentos da tesouraria no mes.</Text> : o.cashUses.lines.length === 0 ? <Text style={s.small}>Nenhum movimento com variacao ou peso relevante.</Text> : (
              <>
                {o.cashUses.lines.map((l) => <Use key={l.key} l={l} prev={prev} />)}
                <Text style={s.small}>Selecionados por variacao material ou peso nas saidas, sem categoria fixa.</Text>
              </>
            )}
          </View>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>CAPEX e investidores</Text>
            {!o.capex?.investment ? <Text style={s.small}>Sem lancamentos da tesouraria no mes.</Text> : (
              <>
                <View style={s.line}><Text>CAPEX do mes (saidas de investimento, como no Fluxo de caixa)</Text><Text style={s.bold}>{brl(o.capex.investment.totalCents)}  {o.capex.investment.deltaPct === null ? "sem comparacao" : `${t(signedPct(o.capex.investment.deltaPct))} vs. ${fmtPeriod(prev)}`}</Text></View>
                {o.capex.investment.partnerCardCents > 0 && <Text style={s.small}>Dos quais {brl(o.capex.investment.partnerCardCents)} pagos no cartao de socios.</Text>}
              </>
            )}
            <View style={[s.line, { marginTop: 5 }]}><Text>Aportes de investidores (nao e receita)</Text><Text style={s.bold}>{!o.investors?.current ? "sem dados" : brl(o.investors.current.totalCents)}</Text></View>
          </View>
        </View>
        <Footer o={o} meta={meta} />
      </Page>

      {/* Pagina 4 - Leitura + O que acompanhar no proximo mes */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={s.card}>
          <Text style={s.h2}>Leitura do mes</Text>
          <Text style={{ fontSize: 10.5, lineHeight: 1.5 }}>{t(o.reading) || "Sem dados suficientes para uma leitura do mes."}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.h2}>O que merece atencao no proximo mes</Text>
          {o.watchlist.length === 0 ? <Text style={s.small}>Nenhum ponto de acompanhamento com os dados disponiveis.</Text> : o.watchlist.map((w, n) => (
            <View key={w.id} style={{ marginBottom: 4 }} wrap={false}>
              <Text style={s.bold}>{n + 1}. {t(w.title)}</Text>
              <Text style={{ color: C.muted }}>Observacao: {t(w.observation)}</Text>
            </View>
          ))}
        </View>
        <View style={s.card}>
          <Text style={s.h2}>O que este resumo ainda nao consegue mostrar</Text>
          {o.limitations.map((l) => <Text key={l} style={{ marginBottom: 2 }}>- {t(l)}</Text>)}
        </View>
        <Footer o={o} meta={meta} />
      </Page>
    </Document>
  );
}
