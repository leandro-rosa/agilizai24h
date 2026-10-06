import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { CONTRIBUTION_KIND_LABELS } from "@/lib/api/capex";
import { date, period as fmtPeriod } from "@/lib/format";
import { reasonLabel } from "@/lib/removal-reasons";
import { BEHAVIOR_LABELS } from "../product-behavior";
import { signedPct, signedPp, type RateDelta, type ValueDelta } from "../compare";
import { monthName } from "../reading";
import { SIGNAL_LABELS, TESTS } from "../tests";
import type { CashUseLine, KpiResult, Overview, ProductRow } from "../types";

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

function Kpi({ k, prev }: { k: KpiResult; prev: string }) {
  const rate = k.kind === "rate";
  const p = rate ? (k.vsPrevious as RateDelta).pp : (k.vsPrevious as ValueDelta).pct;
  const a = rate ? (k.vsAvg3 as RateDelta).pp : (k.vsAvg3 as ValueDelta).pct;
  const fmt = (v: number | null) => (rate ? signedPp(v) : signedPct(v));
  const color = (v: number | null) => (v === null || v === 0 ? C.muted : (v > 0) === k.goodWhenUp ? C.good : C.bad);
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLabel}>{k.label}</Text>
      <Text style={s.kpiValue}>{k.value === null ? "Indisponivel" : rate ? pct(k.value) : brl(k.value)}</Text>
      <Text style={{ fontSize: 7.5, color: color(p) }}>{t(fmt(p))} vs. {fmtPeriod(prev)}</Text>
      <Text style={{ fontSize: 7.5, color: color(a) }}>{t(fmt(a))} vs. media 3 meses</Text>
      <Text style={[s.small, { marginTop: 2 }]}>{t(k.note)}</Text>
    </View>
  );
}

function ProductTable({ rows }: { rows: ProductRow[] }) {
  return (
    <View>
      <View style={s.th}>
        <Text style={[{ flex: 3 }, s.bold]}>Produto</Text>
        <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Unid.</Text>
        <Text style={[{ flex: 1.4, textAlign: "right" }, s.bold]}>Fatur.</Text>
        <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Margem</Text>
        <Text style={[{ flex: 1.2, textAlign: "right" }, s.bold]}>vs. mes ant.</Text>
        <Text style={[{ flex: 2.2, textAlign: "right" }, s.bold]}>Comportamento</Text>
      </View>
      {rows.map((r) => (
        <View key={r.sku} style={s.line} wrap={false}>
          <Text style={{ flex: 3 }}>{t(r.name)}</Text>
          <Text style={{ flex: 1, textAlign: "right" }}>{r.units}</Text>
          <Text style={{ flex: 1.4, textAlign: "right" }}>{brl(r.revenueCents)}</Text>
          <Text style={{ flex: 1, textAlign: "right" }}>{pct(r.marginPct, 0)}</Text>
          <Text style={{ flex: 1.2, textAlign: "right" }}>{r.deltaRevenuePct === null ? "-" : t(signedPct(r.deltaRevenuePct, 0))}</Text>
          <Text style={{ flex: 2.2, textAlign: "right" }}>{t(BEHAVIOR_LABELS[r.behavior])}</Text>
        </View>
      ))}
    </View>
  );
}

function Use({ l, prev }: { l: CashUseLine; prev: string }) {
  return (
    <View style={s.line}>
      <Text>{t(l.label)}</Text>
      <Text>{brl(l.currentCents)}  {l.deltaPct === null ? "sem comparacao" : `${t(signedPct(l.deltaPct))} vs. ${fmtPeriod(prev)}`}</Text>
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
  return (
    <Document title={`Resumo Mensal Agiliz ${o.period}`} author="Agiliz.ai">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={[s.row, { marginBottom: 10 }]}>{o.kpis.map((k) => <Kpi key={k.key} k={k} prev={prev} />)}</View>
        <View style={s.row}>
          <View style={[s.card, s.col, { flex: 3 }]}>
            <Text style={s.h2}>O que aconteceu este mes</Text>
            {o.insights.length === 0 ? <Text style={s.small}>Nenhuma variacao material com os dados disponiveis.</Text> : o.insights.map((i, n) => (
              <View key={i.id} style={{ marginBottom: 4 }} wrap={false}>
                <Text style={s.bold}>{n + 1}. {t(i.title)}</Text>
                <Text style={{ color: C.muted }}>{t(i.detail)}</Text>
              </View>
            ))}
          </View>
          <View style={[s.card, s.col, { flex: 2 }]}>
            <Text style={s.h2}>Resumo da rede</Text>
            {!o.stores ? <Unavail what="DRE por loja" /> : (
              <>
                <Text>{o.stores.compared} lojas comparadas: {o.stores.up} cresceram, {o.stores.down} recuaram, {o.stores.stable} estaveis.</Text>
                <Text style={[s.small, { marginTop: 5 }, s.bold]}>Principais contribuicoes para o crescimento</Text>
                {o.stores.topGrowth.map((x) => <View key={x.storeId} style={s.line}><Text>{t(x.name)}</Text><Text>+{brl(x.deltaCents)}{x.deltaPct !== null ? `  +${(x.deltaPct * 100).toFixed(0)}%` : ""}</Text></View>)}
                <Text style={[s.small, { marginTop: 5 }, s.bold]}>Pontos de atencao</Text>
                {o.stores.attention.length === 0 ? <Text style={s.small}>Nenhum ponto material.</Text> : o.stores.attention.map((x) => <Text key={x.storeId}>{t(x.name)}: {t(x.reasons.join("; "))}</Text>)}
              </>
            )}
          </View>
        </View>
        <Footer o={o} meta={meta} />
      </Page>

      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={s.card}>
          <Text style={s.h2}>Produtos - desempenho do mes</Text>
          {!o.products ? <Unavail what="vendas do mes nao importadas" /> : (
            <View style={s.row}>
              <View style={s.col}><Text style={[s.bold, { marginBottom: 3 }]}>Mais vendidos</Text><ProductTable rows={o.products.topSold.slice(0, 7)} /></View>
              <View style={s.col}>
                <Text style={[s.bold, { marginBottom: 3 }]}>Em alta</Text>
                {o.products.rising.length ? <ProductTable rows={o.products.rising.slice(0, 4)} /> : <Text style={s.small}>Nenhum produto com alta material.</Text>}
                <Text style={[s.bold, { marginVertical: 3 }]}>Em queda</Text>
                {o.products.falling.length ? <ProductTable rows={o.products.falling.slice(0, 4)} /> : <Text style={s.small}>Nenhum produto com queda material.</Text>}
              </View>
            </View>
          )}
          <Text style={[s.small, { marginTop: 4 }]}>Margem = (receita - custo unitario datado x unidades) / receita, so sobre SKUs com custo resolvido. Classificacoes sao evidencia, nao decisao.</Text>
        </View>
        <View style={s.card}>
          <Text style={s.h2}>Produtos em teste</Text>
          {!o.tests ? <Unavail what="abastecimento" /> : o.tests.rows.length === 0 ? (
            <Text style={s.small}>Nenhum SKU com primeiro abastecimento nos ultimos {TESTS.WINDOW_MONTHS} meses em ate {TESTS.MAX_STORES} lojas.</Text>
          ) : (
            <View>
              <View style={s.th}>
                <Text style={[{ flex: 3 }, s.bold]}>Produto</Text>
                <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Lojas</Text>
                <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Unid.</Text>
                <Text style={[{ flex: 1.2, textAlign: "right" }, s.bold]}>Perdas</Text>
                <Text style={[{ flex: 1, textAlign: "right" }, s.bold]}>Margem</Text>
                <Text style={[{ flex: 1.6, textAlign: "right" }, s.bold]}>Tempo de teste</Text>
                <Text style={[{ flex: 1.6, textAlign: "right" }, s.bold]}>Sinal</Text>
              </View>
              {o.tests.rows.slice(0, 8).map((r) => (
                <View key={r.sku} style={s.line} wrap={false}>
                  <Text style={{ flex: 3 }}>{t(r.name)}</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{r.storesSold}/{r.storesRestocked}</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{r.unitsSold}</Text>
                  <Text style={{ flex: 1.2, textAlign: "right" }}>{r.lossCents === null ? "-" : brl(r.lossCents)}</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{pct(r.marginPct, 0)}</Text>
                  <Text style={{ flex: 1.6, textAlign: "right" }}>{r.monthsInTest} {r.monthsInTest === 1 ? "mes" : "meses"} (desde {fmtPeriod(r.firstPeriod)})</Text>
                  <Text style={{ flex: 1.6, textAlign: "right" }}>{t(SIGNAL_LABELS[r.signal])}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[s.small, { marginTop: 4 }]}>Lista derivada do abastecimento (primeiro abastecimento na rede em ate {TESTS.MAX_STORES} lojas, regra provisoria). Sinal e evidencia, nao decisao.</Text>
        </View>
        <Footer o={o} meta={meta} />
      </Page>

      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={s.row}>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>Abastecimento e perdas</Text>
            {!o.loss ? <Unavail what="nenhuma loja reconciliada no mes" /> : (
              <>
                <View style={s.line}><Text>Total abastecido (custo)</Text><Text style={s.bold}>{brl(o.loss.restockedCents)}</Text></View>
                <View style={s.line}><Text>Perdas (R$)</Text><Text style={s.bold}>{brl(o.loss.lossCents)}</Text></View>
                <View style={s.line}><Text>Perda / receita liquida</Text><Text style={s.bold}>{pct(o.loss.lossToRevenue)}</Text></View>
                <View style={s.line}><Text>Perda / custo abastecido</Text><Text style={s.bold}>{pct(o.loss.lossToSupplied)}</Text></View>
                <Text style={[s.small, s.bold, { marginTop: 5 }]}>Principais motivos de perda</Text>
                {o.loss.byReason.map((r) => <View key={r.reason} style={s.line}><Text>{t(reasonLabel(r.reason))}</Text><Text>{brl(r.valueCents)}  {pct(r.share, 0)}</Text></View>)}
                <Text style={[s.small, s.bold, { marginTop: 5 }]}>Produtos com maior perda</Text>
                {o.loss.topSkus.slice(0, 5).map((x) => <View key={x.sku} style={s.line}><Text>{t(x.name)}</Text><Text>{brl(x.valueCents)}  {pct(x.share, 0)}</Text></View>)}
                {o.loss.incompleteStores > 0 && <Text style={[s.small, { color: C.bad }]}>{o.loss.incompleteStores} loja(s) com reconciliacao incompleta - valores podem estar subestimados.</Text>}
              </>
            )}
          </View>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>Financeiro e caixa</Text>
            {o.cash.closing === null ? <Unavail what="fluxo de caixa da tesouraria" /> : (
              <>
                <View style={s.line}><Text>Saldo inicial</Text><Text style={s.bold}>{brl(o.cash.opening)}</Text></View>
                <View style={s.line}><Text>Entradas</Text><Text style={s.bold}>{brl(o.cash.inflow)}</Text></View>
                <View style={s.line}><Text>Saidas</Text><Text style={s.bold}>{brl(o.cash.outflow)}</Text></View>
                <View style={s.line}><Text>Saldo final</Text><Text style={s.bold}>{brl(o.cash.closing)}</Text></View>
                {o.cash.operatingPositiveCashFell && o.cash.cashDeltaCents !== null && <Text style={{ marginTop: 3 }}>Apesar do resultado operacional positivo, o caixa caiu {brl(Math.abs(o.cash.cashDeltaCents))} no mes.</Text>}
              </>
            )}
            <View style={[s.line, { marginTop: 5 }]}><Text>A receber vencido{o.cash.agingReference ? ` (em ${date(o.cash.agingReference)})` : ""}</Text><Text style={s.bold}>{o.cash.overdueCents === null ? "-" : brl(o.cash.overdueCents)}</Text></View>
            <View style={s.line}><Text>A vencer (todas as notas em aberto)</Text><Text style={s.bold}>{o.cash.notDueCents === null ? "-" : brl(o.cash.notDueCents)}</Text></View>
            <Text style={s.small}>Notas fiscais a emitir nao existem como dado no sistema.</Text>
          </View>
        </View>
        <View style={s.row}>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>Principais movimentos financeiros</Text>
            {!o.cashUses ? <Unavail what="tesouraria" /> : (
              <>
                {o.cashUses.stock && <Use l={o.cashUses.stock} prev={prev} />}
                {o.cashUses.capex && <Use l={o.cashUses.capex} prev={prev} />}
                {o.cashUses.expenses.map((e) => <Use key={e.key} l={e} prev={prev} />)}
                {o.cashUses.stockVsRevenue?.stockDeltaPct != null && o.cashUses.stockVsRevenue.revenueDeltaPct !== null && (
                  <Text style={s.small}>Compras de estoque {t(signedPct(o.cashUses.stockVsRevenue.stockDeltaPct))} com faturamento {t(signedPct(o.cashUses.stockVsRevenue.revenueDeltaPct))} (fato, sem conclusao de eficiencia).</Text>
                )}
              </>
            )}
          </View>
          <View style={[s.card, s.col]}>
            <Text style={s.h2}>CAPEX e investidores</Text>
            {!o.capex?.investment ? <Unavail what="tesouraria" /> : (
              <>
                <View style={s.line}><Text>CAPEX do mes (saidas de investimento, como no Fluxo de caixa)</Text><Text style={s.bold}>{brl(o.capex.investment.totalCents)}  {o.capex.investment.deltaPct === null ? "sem comparacao" : `${t(signedPct(o.capex.investment.deltaPct))} vs. ${fmtPeriod(prev)}`}</Text></View>
                {o.capex.investment.top.map((x) => <View key={x.category} style={s.line}><Text>{t(x.category)}</Text><Text>{brl(x.cents)}</Text></View>)}
                {o.capex.investment.partnerCardCents > 0 && <Text style={s.small}>Dos quais {brl(o.capex.investment.partnerCardCents)} pagos no cartao de socios.</Text>}
              </>
            )}
            <Text style={s.small}>Itens de CAPEX com loja atribuida (capex-service): {!o.capex?.current ? "indisponivel" : o.capex.current.totalCents === 0 ? "nenhum item datado no mes" : brl(o.capex.current.totalCents)}.</Text>
            <Text style={[s.small, s.bold, { marginTop: 5 }]}>Aportes de investidores (nao e receita operacional)</Text>
            {!o.investors?.current ? <Unavail what="aportes" /> : (
              <>
                <View style={s.line}><Text>Aportes no mes</Text><Text style={s.bold}>{brl(o.investors.current.totalCents)}  {o.investors.deltaPct === null ? "sem comparacao" : `${t(signedPct(o.investors.deltaPct))} vs. ${fmtPeriod(prev)}`}</Text></View>
                {o.investors.current.byKind.map((k) => <View key={k.kind} style={s.line}><Text>{t(CONTRIBUTION_KIND_LABELS[k.kind] ?? k.kind)}</Text><Text>{brl(k.cents)}</Text></View>)}
              </>
            )}
            <Text style={s.small}>O sistema so registra aportes; devolucao, distribuicao e remuneracao nao existem como dado.</Text>
          </View>
        </View>
        <Footer o={o} meta={meta} />
      </Page>

      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={s.card}>
          <Text style={s.h2}>Leitura do mes</Text>
          <Text style={{ fontSize: 10.5, lineHeight: 1.5 }}>{t(o.reading) || "Sem dados suficientes para uma leitura do mes."}</Text>
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
