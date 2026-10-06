import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { date, period as fmtPeriod } from "@/lib/format";
import { reasonLabel } from "@/lib/removal-reasons";
import { BEHAVIOR_LABELS } from "../product-behavior";
import { baseText } from "../ranking";
import { signedPct, signedPp, type RateDelta, type ValueDelta } from "../compare";
import { monthName } from "../reading";
import { overdueSummary } from "../overdue";
import { priceImpactReading } from "../price-volume";
import { SIGNAL_LABELS } from "../tests";
import type { CashUseLine, Highlight, Insight, KpiResult, LossChange, Overview, ProductRow, StoreExplainers } from "../types";

export interface ReportMeta {
  version: number;
  generatedAt: string;
  baseAt: string;
  /** URL absoluta do logotipo (`/brand/lockup-dark.png`); sem ela o cabeçalho usa só o texto. */
  logoSrc?: string;
}

/** A fonte padrão (Helvetica) não tem "−", setas nem "≥": troca por equivalentes seguros em vez de exibir lixo. */
const t = (s: string) => s.replace(/−/g, "-").replace(/→/g, "->").replace(/[↑↓]/g, "").replace(/≥/g, ">=").replace(/…/g, "...").replace(/\u00a0/g, " ").replace(/\s{2,}/g, " ").trim();
const brl = (c: number | null | undefined) =>
  c === null || c === undefined ? "-" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(c / 100).replace(/\u00a0/g, " ");
const pct = (v: number | null, d = 1) => (v === null ? "-" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const num = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
/** "-0%" não existe: variação que arredonda para zero aparece como "0%". */
const dpct = (v: number | null, d = 0) => (v === null ? "-" : Math.round(v * 10 ** (d + 2)) === 0 ? "0%" : t(signedPct(v, d)));
/** Texto longo de insight vira resumo na página; o detalhe completo está na tela. */
const clip = (str: string, n = 190) => (str.length > n ? `${str.slice(0, n).replace(/\s+\S*$/, "")}...` : str);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mesma paleta do painel escuro (globals.css `.dark`), um pouco mais profunda para o papel/tela cheia. */
const C = {
  bg: "#150f17",
  card: "#201826",
  cardHi: "#2a1f31",
  border: "#3a2c42",
  ink: "#fff4e6",
  muted: "#a89e97",
  brand: "#e91e8c",
  brandSoft: "#4a1537",
  good: "#3fbf83",
  bad: "#ff736a",
  warn: "#e89b3c",
};

const s = StyleSheet.create({
  page: { paddingTop: 20, paddingBottom: 32, paddingHorizontal: 28, fontSize: 9.5, fontFamily: "Helvetica", color: C.ink, backgroundColor: C.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  logo: { height: 28, width: 92 },
  logoText: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.brand },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  meta: { fontSize: 7.5, color: C.muted, textAlign: "right", marginBottom: 1.5 },
  pill: { alignSelf: "flex-end", marginTop: 3, paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: C.brandSoft, color: C.brand, fontSize: 7.5, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", gap: 8 },
  col: { flex: 1 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10 },
  cardGap: { marginBottom: 10 },
  h2: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  h3: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.muted, marginBottom: 3, textTransform: "uppercase" },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8.2, color: C.muted },
  line: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2.5 },
  kpiLabel: { fontSize: 9, color: C.muted },
  kpiValue: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 3, marginBottom: 3 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 2.5, marginBottom: 3 },
  thText: { fontSize: 7.5, color: C.muted, fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 14, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: C.muted },
});

const toneColor = (tone: Insight["tone"]) => (tone === "positive" ? C.good : tone === "negative" ? C.bad : C.warn);
const deltaColor = (v: number | null, goodWhenUp: boolean) => (v === null || v === 0 ? C.muted : v > 0 === goodWhenUp ? C.good : C.bad);

function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, marginTop: 2.5 }} />;
}

/** Título de seção: marcador magenta + texto (mesma ideia dos ícones do painel, sem depender de fonte de ícones). */
function Title({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, marginTop: 2 }}>
      <View style={{ width: 3, height: 13, borderRadius: 2, backgroundColor: C.brand }} />
      <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>{children}</Text>
      {hint ? <Text style={s.small}>{hint}</Text> : null}
    </View>
  );
}

const Empty = ({ children }: { children: string }) => <Text style={s.small}>{children}</Text>;

function Header({ o, meta }: { o: Overview; meta: ReportMeta }) {
  return (
    <View style={s.header}>
      <View style={s.brandRow}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf não tem alt */}
        {meta.logoSrc ? <Image src={meta.logoSrc} style={s.logo} /> : <Text style={s.logoText}>agiliz.ai</Text>}
        <View>
          <Text style={s.title}>Visão geral — {cap(t(monthName(o.period)))}</Text>
          <Text style={s.sub}>Resumo executivo mensal · vs. {fmtPeriod(o.previousPeriod)} e vs. média dos 3 meses anteriores</Text>
        </View>
      </View>
      <View>
        <Text style={s.meta}>Fechamento do mês: {date(o.closedAt)}</Text>
        <Text style={s.meta}>Base do DRE: {date(meta.baseAt)} · Gerado em {new Date(meta.generatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</Text>
        <Text style={s.pill}>Resumo {fmtPeriod(o.period)} · Versão {meta.version}</Text>
      </View>
    </View>
  );
}

function Footer({ o, meta }: { o: Overview; meta: ReportMeta }) {
  return (
    <View style={s.footer} fixed>
      <Text>Agiliz.ai · Resumo executivo mensal · {fmtPeriod(o.period)} · versão {meta.version}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
    </View>
  );
}

function Kpi({ k, prev }: { k: KpiResult; prev: string }) {
  const rate = k.kind === "rate";
  const p = rate ? (k.vsPrevious as RateDelta).pp : (k.vsPrevious as ValueDelta).pct;
  const a = rate ? (k.vsAvg3 as RateDelta).pp : (k.vsAvg3 as ValueDelta).pct;
  const fmt = (v: number | null) => (rate ? signedPp(v) : signedPct(v));
  const show = (v: number | null) => (v === null ? "sem dados" : rate ? pct(v) : brl(v));
  return (
    <View style={[s.card, { width: "32.6%", marginBottom: 8 }]} wrap={false}>
      <Text style={s.kpiLabel}>{k.label}</Text>
      <Text style={s.kpiValue}>{k.value === null ? "Sem dados" : show(k.value)}</Text>
      {p === null ? (
        <Text style={s.small}>sem comparação com {fmtPeriod(prev)} (sem base)</Text>
      ) : (
        <Text style={{ fontSize: 9, color: deltaColor(p, k.goodWhenUp), fontFamily: "Helvetica-Bold" }}>
          {t(fmt(p))} <Text style={{ color: C.muted, fontFamily: "Helvetica" }}>vs. {fmtPeriod(prev)} ({show(k.previous)})</Text>
        </Text>
      )}
      {a === null ? (
        <Text style={s.small}>sem média de 3 meses (sem base)</Text>
      ) : (
        <Text style={{ fontSize: 9, color: deltaColor(a, k.goodWhenUp), fontFamily: "Helvetica-Bold" }}>
          {t(fmt(a))} <Text style={{ color: C.muted, fontFamily: "Helvetica" }}>vs. média 3 meses</Text>
        </Text>
      )}
      <Text style={[s.small, { marginTop: 3 }]}>{t(k.note)}</Text>
    </View>
  );
}

function HighlightCard({ label, h, color }: { label: string; h: Highlight | null; color: string }) {
  return (
    <View style={[s.card, s.col, { borderLeftWidth: 3, borderLeftColor: color }]} wrap={false}>
      <Text style={[s.h3, { color }]}>{label}</Text>
      {h ? (
        <>
          <Text style={[s.bold, { marginBottom: 2 }]}>{t(h.title)}</Text>
          <Text style={s.small}>{clip(t(h.detail), 110)}</Text>
        </>
      ) : (
        <Text style={s.small}>Sem dados suficientes para esta competência.</Text>
      )}
    </View>
  );
}

function InsightItem({ i, n }: { i: Insight; n: number }) {
  const label = i.tone === "positive" ? "Positivo" : i.tone === "negative" ? "Negativo" : "Atenção";
  return (
    <View style={[s.card, { width: "49.4%", marginBottom: 8, borderLeftWidth: 3, borderLeftColor: toneColor(i.tone) }]} wrap={false}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
        <Text style={[s.small, { color: toneColor(i.tone), fontFamily: "Helvetica-Bold" }]}>{n}. {label}</Text>
      </View>
      <Text style={[s.bold, { marginBottom: 2 }]}>{t(i.title)}</Text>
      <Text style={s.small}>{clip(t(i.detail), 120)}</Text>
    </View>
  );
}

/** Produtos: 6 colunas curtas (a análise por loja de cada produto fica na tela). */
function ProductTable({ title, rows, empty }: { title: string; rows: ProductRow[]; empty: string }) {
  return (
    <View style={[s.card, s.col]}>
      <Text style={s.h3}>{title}</Text>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <View>
          <View style={s.th}>
            <Text style={[s.thText, { flex: 3.2 }]}>Produto</Text>
            <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Unid.</Text>
            <Text style={[s.thText, { flex: 1.3, textAlign: "right" }]}>Receita</Text>
            <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Margem</Text>
            <Text style={[s.thText, { flex: 2.4, textAlign: "right" }]}>vs. mês anterior</Text>
          </View>
          {rows.slice(0, 4).map((r) => {
            const up = (r.deltaUnitsPct ?? 0) > 0;
            return (
              <View key={r.sku} style={{ marginBottom: 3 }} wrap={false}>
                <View style={{ flexDirection: "row" }}>
                  <Text style={{ flex: 3.2 }}>{t(r.name).slice(0, 34)}</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{num(r.units)}</Text>
                  <Text style={{ flex: 1.3, textAlign: "right" }}>{brl(r.revenueCents)}</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{pct(r.marginPct, 0)}</Text>
                  <Text style={{ flex: 2.4, textAlign: "right", color: r.unitsPrevious === null ? C.muted : up ? C.good : C.bad }}>
                    {r.unitsPrevious === null ? "sem base" : r.deltaUnitsPct === null ? "novo no mês" : dpct(r.deltaUnitsPct)}
                  </Text>
                </View>
                <Text style={[s.small, { fontSize: 6.8 }]}>
                  {t(BEHAVIOR_LABELS[r.behavior])}
                  {r.unitsPrevious !== null ? ` · ${t(baseText(r.unitsPrevious, r.units, num, "un."))}` : ""}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Explainers({ title, e, sign, color }: { title: string; e: StoreExplainers; sign: "+" | "-"; color: string }) {
  return (
    <View style={s.col}>
      <Text style={[s.h3, { color }]}>{title}</Text>
      {e.stores.length === 0 ? (
        <Empty>Nenhuma loja.</Empty>
      ) : (
        <>
          <Text style={[s.small, { marginBottom: 2 }]}>
            {e.stores.length} de {e.storeCount} lojas explicam {Math.round(e.coveredShare * 100)}% ({brl(e.totalCents)})
          </Text>
          {e.stores.slice(0, 3).map((x) => (
            <View key={x.storeId} style={s.line} wrap={false}>
              <Text>{t(x.name)}</Text>
              <Text>
                <Text style={{ color }}>{sign}{brl(Math.abs(x.deltaCents))}</Text>
                <Text style={s.small}>  {Math.round(x.share * 100)}%  ({brl(x.previousCents)} {"->"} {brl(x.currentCents)})</Text>
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function Bar({ share, color = C.brand }: { share: number | null; color?: string }) {
  const w = Math.max(0, Math.min(1, share ?? 0));
  return (
    <View style={{ height: 5, borderRadius: 3, backgroundColor: C.border, flex: 1, marginHorizontal: 6, marginTop: 2.5 }}>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: color, width: `${Math.round(w * 100)}%` }} />
    </View>
  );
}

function LossList({ title, rows, reason }: { title: string; rows: LossChange[]; reason?: boolean }) {
  return (
    <View>
      <Text style={s.h3}>{title}</Text>
      {rows.length === 0 ? (
        <Empty>Sem variação relevante.</Empty>
      ) : (
        rows.map((c) => (
          <View key={c.label} style={{ marginBottom: 3 }} wrap={false}>
            <View style={s.line}>
              <Text>{t(reason ? reasonLabel(c.label) : c.label).slice(0, 30)}</Text>
              <Text style={{ color: c.deltaCents > 0 ? C.bad : C.good }}>{c.deltaCents > 0 ? "+" : "-"}{brl(Math.abs(c.deltaCents))}</Text>
            </View>
            <Text style={[s.small, { fontSize: 6.8 }]}>{brl(c.previousCents)} {"->"} {brl(c.currentCents)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function Stat({ label, value, note, color }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <View style={[s.card, s.col]} wrap={false}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, { fontSize: 15, color: color ?? C.ink }]}>{value}</Text>
      {note ? <Text style={s.small}>{note}</Text> : null}
    </View>
  );
}

function Use({ l, prev }: { l: CashUseLine; prev: string }) {
  const up = (l.deltaPct ?? 0) > 0;
  return (
    <View style={{ marginBottom: 6 }} wrap={false}>
      <View style={s.line}>
        <Text style={s.bold}>{t(l.label)}</Text>
        <Text style={s.bold}>{brl(l.currentCents)}</Text>
      </View>
      <View style={{ flexDirection: "row" }}>
        <Text style={[s.small, { width: 118 }]}>
          {l.previousCents === null ? "sem base no mês anterior" : `${t(baseText(l.previousCents, l.currentCents, (n) => brl(n), ""))} vs. ${fmtPeriod(prev)}`}
        </Text>
        <Bar share={l.shareOfOutflow} />
        <Text style={[s.small, { width: 92, textAlign: "right" }]}>
          {l.shareOfOutflow !== null ? `${pct(l.shareOfOutflow, 0)} das saídas` : ""}
          {l.deltaPct !== null && l.previousCents !== null && l.previousCents > 0 ? ` · ` : ""}
          {l.deltaPct !== null && l.previousCents !== null && l.previousCents > 0 ? <Text style={{ color: up ? C.warn : C.good }}>{t(signedPct(l.deltaPct, 0))}</Text> : null}
        </Text>
      </View>
    </View>
  );
}

export function MonthlyReport({ o, meta }: { o: Overview; meta: ReportMeta }) {
  const prev = o.previousPeriod;
  const lossK = o.kpis.find((k) => k.key === "loss");
  const lossDelta = lossK ? (lossK.vsPrevious as ValueDelta).pct : null;
  const positives = o.insights.filter((i) => i.tone === "positive").slice(0, 4);
  const negatives = o.insights.filter((i) => i.tone === "negative").slice(0, 4);

  // "Onde precisamos agir?": só o que os dados já apontam — loja com ponto de atenção, SKU e motivo de maior perda, conciliação.
  const act: { title: string; detail: string }[] = [];
  for (const st of o.stores?.attention.slice(0, 2) ?? []) act.push({ title: `Loja ${st.name}`, detail: `${st.reasons.join("; ")}.` });
  const topSku = o.loss?.topSkus[0];
  if (topSku) act.push({ title: `Produto ${topSku.name}`, detail: `Maior perda do mês: ${brl(topSku.valueCents)}${topSku.share !== null ? ` (${pct(topSku.share, 0)} das perdas)` : ""}.` });
  const topReason = o.loss?.byReason[0];
  if (topReason) act.push({ title: `Motivo: ${reasonLabel(topReason.reason)}`, detail: `${brl(topReason.valueCents)}${topReason.share !== null ? `, ${pct(topReason.share, 0)} das perdas` : ""}.` });
  if (o.loss && o.loss.incompleteStores > 0) act.push({ title: "Conciliação incompleta", detail: `${o.loss.incompleteStores} lojas com SKU sem custo ou saldo inconsistente; perdas podem estar subestimadas.` });

  return (
    <Document title={`Resumo Mensal Agiliz ${o.period}`} author="Agiliz.ai">
      {/* 1 — Como foi o mês? */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>{o.kpis.map((k) => <Kpi key={k.key} k={k} prev={prev} />)}</View>
        <Title>Destaques do mês</Title>
        <View style={[s.row, s.cardGap]}>
          <HighlightCard label="Produto destaque" h={o.highlights.product} color={C.warn} />
          <HighlightCard label="Maior crescimento" h={o.highlights.growth} color={C.good} />
          <HighlightCard label="Maior ponto de atenção" h={o.highlights.attention} color={C.bad} />
        </View>
        <Title hint="ordenado por relevância gerencial, não pelo tamanho do %">O que realmente aconteceu neste mês?</Title>
        {o.insights.length === 0 ? (
          <Empty>Nenhuma variação material com os dados disponíveis.</Empty>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>{o.insights.slice(0, 4).map((i, n) => <InsightItem key={i.id} i={i} n={n + 1} />)}</View>
        )}
        <Footer o={o} meta={meta} />
      </Page>

      {/* 2 — Onde aconteceu? Desempenho comercial */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={[s.card, s.cardGap]}>
          <Title>Resumo da rede</Title>
          {!o.stores ? (
            <Empty>Sem dados — DRE por loja.</Empty>
          ) : (
            <View style={s.row}>
              <View style={{ width: 150 }}>
                <Text style={[s.kpiValue, { fontSize: 20, marginTop: 0 }]}>{o.stores.compared} <Text style={[s.small, { fontFamily: "Helvetica" }]}>lojas comparadas</Text></Text>
                <View style={{ flexDirection: "row", gap: 5, marginBottom: 2 }}><Dot color={C.good} /><Text>{o.stores.up} cresceram</Text></View>
                <View style={{ flexDirection: "row", gap: 5, marginBottom: 2 }}><Dot color={C.bad} /><Text>{o.stores.down} recuaram</Text></View>
                <View style={{ flexDirection: "row", gap: 5 }}><Dot color={C.muted} /><Text>{o.stores.stable} estáveis</Text></View>
                <Text style={[s.small, { marginTop: 4 }]}>Base: {o.stores.basis === "vendas" ? "vendas de cada loja" : "receita líquida por loja (DRE)"}</Text>
              </View>
              <Explainers title="Quem explicou o crescimento" e={o.stores.growthExplainers} sign="+" color={C.good} />
              <Explainers title="Quem explicou a queda" e={o.stores.declineExplainers} sign="-" color={C.bad} />
            </View>
          )}
        </View>

        <Title hint="a análise por loja de cada produto está na tela">Produtos que movimentaram o mês</Title>
        {!o.products ? (
          <Empty>Sem dados — vendas do mês não importadas.</Empty>
        ) : (
          <View style={s.cardGap}>
            <View style={[s.row, { marginBottom: 8 }]}>
              <ProductTable title="Mais vendidos" rows={o.products.topSold} empty="Sem vendas no mês." />
              <ProductTable title="Em alta" rows={o.products.rising} empty="Nenhum produto com alta material." />
            </View>
            <View style={s.row}>
              <ProductTable title="Em queda" rows={o.products.falling} empty="Nenhum produto com queda material." />
              <ProductTable title="Mudança relevante" rows={o.products.relevantChange} empty="Nenhuma mudança de comportamento relevante." />
            </View>
          </View>
        )}
        <Footer o={o} meta={meta} />
      </Page>

      {/* 3 — Produtos em teste */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={[s.card, s.cardGap]}>
          <Title hint="derivado do abastecimento — regra provisória; sinal é evidência, não decisão">Produtos em teste</Title>
          {!o.tests ? (
            <Empty>Sem dados — abastecimento indisponível.</Empty>
          ) : o.tests.rows.length === 0 ? (
            <Empty>Nenhum SKU com primeiro abastecimento nos últimos 3 meses.</Empty>
          ) : (
            <View>
              <View style={s.th}>
                <Text style={[s.thText, { flex: 3.4 }]}>Produto</Text>
                <Text style={[s.thText, { flex: 1.4, textAlign: "right" }]}>Lojas testadas</Text>
                <Text style={[s.thText, { flex: 1.8, textAlign: "right" }]}>Cobertura do teste</Text>
                <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Unid.</Text>
                <Text style={[s.thText, { flex: 1.2, textAlign: "right" }]}>Perdas</Text>
                <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Margem</Text>
                <Text style={[s.thText, { flex: 2, textAlign: "right" }]}>Tempo de teste</Text>
                <Text style={[s.thText, { flex: 1.8, textAlign: "right" }]}>Sinal</Text>
              </View>
              {o.tests.rows.slice(0, 10).map((r) => (
                <View key={r.sku} style={{ marginBottom: 8 }} wrap={false}>
                  <View style={{ flexDirection: "row" }}>
                    <Text style={{ flex: 3.4 }}>{t(r.name).slice(0, 44)}</Text>
                    <Text style={{ flex: 1.4, textAlign: "right" }}>{r.storesRestocked}</Text>
                    <Text style={{ flex: 1.8, textAlign: "right" }}>{o.stores?.activeCount ? `${r.storesRestocked} de ${o.stores.activeCount}` : "-"} · vendeu em {r.storesSold}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{num(r.unitsSold)}</Text>
                    <Text style={{ flex: 1.2, textAlign: "right" }}>{r.lossCents === null ? "-" : brl(r.lossCents)}</Text>
                    <Text style={{ flex: 1, textAlign: "right" }}>{pct(r.marginPct, 0)}</Text>
                    <Text style={{ flex: 2, textAlign: "right" }}>{r.monthsInTest} {r.monthsInTest === 1 ? "mês" : "meses"} (desde {fmtPeriod(r.firstPeriod)})</Text>
                    <Text style={{ flex: 1.8, textAlign: "right", color: r.signal === "positivo" ? C.good : r.signal === "atencao" ? C.warn : C.muted }}>{t(SIGNAL_LABELS[r.signal])}</Text>
                  </View>
                  {r.reasons.length > 0 ? <Text style={[s.small, { fontSize: 6.8 }]}>{t(r.reasons.join(" · "))}</Text> : null}
                </View>
              ))}
              {o.tests.rows.length > 10 ? <Text style={[s.small, { marginTop: 3 }]}>Mostrando 10 de {o.tests.rows.length} produtos em teste.</Text> : null}
            </View>
          )}
        </View>
        {o.skuSuggestions.length > 0 ? (
          <View style={[s.card, s.cardGap]}>
            <Text style={s.h3}>Troca de código de barras a confirmar</Text>
            <Text style={s.small}>{o.skuSuggestions.length} produto(s) parecem novos, mas têm um código antigo de nome parecido que vendia bem e quase parou. Confirme na tela antes de tratá-los como lançamento.</Text>
          </View>
        ) : null}
        <Footer o={o} meta={meta} />
      </Page>

      {/* 3b — Reajustes de preço */}
      {o.priceChanges ? (
        <Page size="A4" orientation="landscape" style={s.page}>
          <Header o={o} meta={meta} />
          <View style={[s.card, s.cardGap]}>
            <Title hint="preço realizado = receita ÷ unidades, já com descontos">Reajustes de preço no mês</Title>
            {(() => {
              const pc = o.priceChanges;
              const rd = priceImpactReading(pc, brl);
              const im = pc.impact;
              const dRev = im.revenueAfterCents - im.revenueBeforeCents;
              const dMar = im.margin ? im.margin.afterCents - im.margin.beforeCents : null;
              const unitsPct = pc.unitsBefore > 0 ? (pc.unitsAfter - pc.unitsBefore) / pc.unitsBefore : null;
              return (
                <>
                  <View style={{ borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 6, borderColor: rd.verdict.margin === "sim" ? C.good : rd.verdict.margin === "nao" ? C.bad : C.border }}>
                    <Text style={s.small}>Vendeu menos — o lucro compensou?</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: rd.verdict.margin === "sim" ? C.good : rd.verdict.margin === "nao" ? C.bad : C.ink, marginVertical: 2 }}>{t(rd.verdict.title)}</Text>
                    <Text>{t(rd.verdict.detail)}</Text>
                  </View>
                  <View style={[s.row, { marginBottom: 6 }]}>
                    <View style={[s.col, { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 8 }]}>
                      <Text style={s.small}>E se os dois meses tivessem o mesmo número de dias?</Text>
                      <Text style={{ fontFamily: "Helvetica-Bold", marginVertical: 2 }}>{t(rd.days.title)}</Text>
                      <Text style={s.small}>{t(rd.days.detail)}</Text>
                    </View>
                    <View style={[s.col, { borderWidth: 1, borderRadius: 8, padding: 8, borderColor: rd.ticket ? (rd.ticket.up ? C.good : C.bad) : C.border }]}>
                      <Text style={s.small}>O ticket médio subiu — e o reajuste explica?</Text>
                      {rd.ticket ? (
                        <>
                          <Text style={{ fontFamily: "Helvetica-Bold", marginVertical: 2, color: rd.ticket.up ? C.good : C.bad }}>{t(rd.ticket.title)}</Text>
                          <Text style={s.small}>{t(rd.ticket.detail)}</Text>
                        </>
                      ) : (
                        <Text style={s.small}>Sem as compras do mês para calcular o ticket médio.</Text>
                      )}
                    </View>
                  </View>
                  <View style={[s.row, { marginBottom: 6 }]}>
                    <Stat label="Dinheiro que entrou (faturamento)" value={brl(im.revenueAfterCents)} color={dRev < 0 ? C.bad : C.good} note={`${brl(im.revenueBeforeCents)} -> ${brl(im.revenueAfterCents)} (${dRev < 0 ? "-" : "+"}${brl(Math.abs(dRev))})`} />
                    <Stat label="Lucro bruto (sobra após o custo)" value={im.margin ? brl(im.margin.afterCents) : "-"} color={dMar === null ? undefined : dMar < 0 ? C.bad : C.good} note={im.margin && dMar !== null ? `${brl(im.margin.beforeCents)} -> ${brl(im.margin.afterCents)} (${dMar < 0 ? "-" : "+"}${brl(Math.abs(dMar))})` : "sem custo resolvido"} />
                    <Stat label="Lucro de cada R$ 100 vendidos" value={im.margin && im.margin.pctAfter !== null ? `R$ ${Math.round(im.margin.pctAfter * 100)}` : "-"} note={im.margin && im.margin.pctBefore !== null ? `antes: R$ ${Math.round(im.margin.pctBefore * 100)}` : undefined} />
                    <Stat label="Unidades vendidas" value={num(pc.unitsAfter)} color={pc.unitsAfter < pc.unitsBefore ? C.bad : C.good} note={`${num(pc.unitsBefore)} -> ${num(pc.unitsAfter)} (${dpct(unitsPct)})`} />
                  </View>
                  <View style={{ marginBottom: 8 }}>{rd.lines.map((l) => <Text key={l} style={[s.small, { marginBottom: 2 }]}>- {t(l)}</Text>)}</View>
                </>
              );
            })()}
            <View style={s.th}>
              <Text style={[s.thText, { flex: 3.4 }]}>Produto</Text>
              <Text style={[s.thText, { flex: 2.4, textAlign: "right" }]}>Preço</Text>
              <Text style={[s.thText, { flex: 2.2, textAlign: "right" }]}>Unidades</Text>
              <Text style={[s.thText, { flex: 1.6, textAlign: "right" }]}>Lucro bruto %</Text>
              <Text style={[s.thText, { flex: 1.4, textAlign: "right" }]}>Faturamento</Text>
            </View>
            {o.priceChanges.rows.slice(0, 6).map((r) => (
              <View key={r.sku} style={{ flexDirection: "row", marginBottom: 4 }} wrap={false}>
                <Text style={{ flex: 3.4 }}>{t(r.name).slice(0, 40)}</Text>
                <Text style={{ flex: 2.4, textAlign: "right" }}>R$ {(r.priceBeforeCents / 100).toFixed(2).replace(".", ",")} {"->"} {(r.priceAfterCents / 100).toFixed(2).replace(".", ",")} <Text style={s.small}>({t(signedPct(r.pricePct, 0))})</Text></Text>
                <Text style={{ flex: 2.2, textAlign: "right" }}>{num(r.unitsBefore)} {"->"} {num(r.unitsAfter)} <Text style={{ color: r.unitsPct < 0 ? C.bad : C.good }}>({t(signedPct(r.unitsPct, 0))})</Text></Text>
                <Text style={{ flex: 1.6, textAlign: "right" }}>{pct(r.marginBefore, 0)} {"->"} {pct(r.marginAfter, 0)}</Text>
                <Text style={{ flex: 1.4, textAlign: "right", color: r.revenueDeltaCents < 0 ? C.bad : C.good }}>{r.revenueDeltaCents < 0 ? "-" : "+"}{brl(Math.abs(r.revenueDeltaCents))}</Text>
              </View>
            ))}
            <Text style={[s.small, { marginTop: 3 }]}>Mostrando 6 de {o.priceChanges.count} reajustados (maior receita); a lista completa está na tela.</Text>
          </View>
          <Footer o={o} meta={meta} />
        </Page>
      ) : null}

      {/* 4 — Por que merece atenção? Abastecimento e perdas */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <Title>Abastecimento e perdas</Title>
        {!o.loss ? (
          <Empty>Sem dados — nenhuma loja reconciliada no mês.</Empty>
        ) : (
          <>
            <View style={[s.row, s.cardGap]}>
              <Stat label="Total abastecido (custo)" value={brl(o.loss.restockedCents)} note="valor de abastecimento — não é compra" />
              <Stat label="Perdas (R$)" value={brl(o.loss.lossCents)} color={C.bad} note={lossDelta === null ? "sem comparação" : `${t(signedPct(lossDelta))} vs. ${fmtPeriod(prev)}`} />
              <Stat label="Perda ÷ receita líquida" value={pct(o.loss.lossToRevenue)} note="base: receita líquida do DRE" />
              <Stat label="Perda ÷ custo abastecido" value={pct(o.loss.lossToSupplied)} note="base: custo abastecido do mês" />
            </View>
            {o.loss.incompleteStores > 0 ? (
              <Text style={[s.small, { color: C.warn, marginBottom: 6 }]}>{o.loss.incompleteStores} loja(s) com reconciliação incompleta — valores podem estar subestimados.</Text>
            ) : null}
            <View style={[s.row, s.cardGap]}>
              <View style={[s.card, s.col]}>
                <Text style={s.h3}>Principais motivos de perda</Text>
                {o.loss.byReason.length === 0 ? <Empty>Sem perdas no mês.</Empty> : o.loss.byReason.slice(0, 4).map((r) => (
                  <View key={r.reason} style={{ flexDirection: "row", marginBottom: 4 }} wrap={false}>
                    <Text style={{ width: 90 }}>{t(reasonLabel(r.reason))}</Text>
                    <Bar share={r.share} />
                    <Text style={{ width: 28, textAlign: "right" }}>{pct(r.share, 0)}</Text>
                    <Text style={[s.small, { width: 48, textAlign: "right" }]}>{brl(r.valueCents)}</Text>
                  </View>
                ))}
              </View>
              <View style={[s.card, s.col]}>
                <Text style={s.h3}>Produtos que mais contribuíram</Text>
                {o.loss.topSkus.slice(0, 5).map((x, n) => (
                  <View key={x.sku} style={s.line} wrap={false}>
                    <Text>{n + 1}. {t(x.name).slice(0, 32)}</Text>
                    <Text>{brl(x.valueCents)}  <Text style={s.small}>{pct(x.share, 0)}</Text></Text>
                  </View>
                ))}
                {o.loss.top3Share !== null ? <Text style={[s.small, { marginTop: 2 }]}>Os 3 maiores somam {pct(o.loss.top3Share, 0)} da perda.</Text> : null}
              </View>
              <View style={[s.card, s.col]}>
                <Text style={s.h3}>O que mudou nas perdas</Text>
                {!o.loss.changes ? (
                  <Empty>Sem perdas do mês anterior para comparar.</Empty>
                ) : (
                  <>
                    <Text style={{ marginBottom: 3 }}>{brl(o.loss.changes.totalPreviousCents)} {"->"} {brl(o.loss.changes.totalCurrentCents)}</Text>
                    <LossList title="Motivos" rows={o.loss.changes.byReason.slice(0, 2)} reason />
                    <View style={{ height: 4 }} />
                    <LossList title="Produtos" rows={o.loss.changes.bySku.slice(0, 2)} />
                  </>
                )}
              </View>
            </View>
          </>
        )}
        <Title>Onde precisamos agir?</Title>
        {act.length === 0 ? (
          <Empty>Nenhum ponto de atenção com os dados disponíveis.</Empty>
        ) : (
          <View style={s.row}>
            {act.slice(0, 4).map((x) => (
              <View key={x.title} style={[s.card, s.col, { borderLeftWidth: 3, borderLeftColor: C.warn }]} wrap={false}>
                <Text style={[s.bold, { marginBottom: 2 }]}>{t(x.title)}</Text>
                <Text style={s.small}>{t(x.detail)}</Text>
              </View>
            ))}
          </View>
        )}
        <Footer o={o} meta={meta} />
      </Page>

      {/* 5 — Financeiro */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={s.row}>
          <View style={[s.card, { flex: 1.15 }]}>
            <Title hint="selecionado pelos dados, sem categoria fixa">Para onde foi o dinheiro?</Title>
            {!o.cashUses ? (
              <Empty>Sem lançamentos da tesouraria no mês.</Empty>
            ) : o.cashUses.lines.length === 0 ? (
              <Empty>Nenhum movimento com variação ou peso relevante.</Empty>
            ) : (
              <>
                {o.cashUses.lines.map((l) => <Use key={l.key} l={l} prev={prev} />)}
                {o.cashUses.stockVsRevenue && o.cashUses.stockVsRevenue.stockDeltaPct !== null && o.cashUses.stockVsRevenue.revenueDeltaPct !== null ? (
                  <Text style={[s.small, { marginTop: 2 }]}>
                    Observação: compras de estoque {t(signedPct(o.cashUses.stockVsRevenue.stockDeltaPct))} enquanto o faturamento variou {t(signedPct(o.cashUses.stockVsRevenue.revenueDeltaPct))}.
                  </Text>
                ) : null}
                <Text style={[s.small, { marginTop: 2 }]}>Compras de estoque (caixa) e CMV (finance) não se somam. Saídas classificadas do mês: {brl(o.cashUses.totalOutflowCents)}.</Text>
              </>
            )}
          </View>
          <View style={[s.col, { gap: 8 }]}>
            <View style={s.card}>
              <Title>Caixa</Title>
              {o.cash.closing === null ? (
                <Empty>Sem dados — fluxo de caixa da tesouraria.</Empty>
              ) : (
                <>
                  <View style={s.line}><Text style={s.small}>Saldo inicial</Text><Text style={s.bold}>{brl(o.cash.opening)}</Text></View>
                  <View style={s.line}><Text style={s.small}>Entradas</Text><Text style={[s.bold, { color: C.good }]}>{brl(o.cash.inflow)}</Text></View>
                  <View style={s.line}><Text style={s.small}>Saídas</Text><Text style={[s.bold, { color: C.bad }]}>{brl(o.cash.outflow)}</Text></View>
                  <View style={s.line}><Text style={s.small}>Saldo final</Text><Text style={s.bold}>{brl(o.cash.closing)}</Text></View>
                  {o.cash.operatingPositiveCashFell && o.cash.cashDeltaCents !== null ? (
                    <Text style={[s.small, { color: C.warn, marginTop: 2 }]}>Observação: resultado operacional positivo e caixa {brl(Math.abs(o.cash.cashDeltaCents))} menor no mês.</Text>
                  ) : null}
                </>
              )}
              <View style={[s.line, { marginTop: 5 }]}>
                <Text style={s.small}>Notas vencidas e não pagas{o.cash.agingReference ? ` (em ${date(o.cash.agingReference)})` : ""}</Text>
                <Text style={[s.bold, { color: o.cash.overdueDetail && o.cash.overdueDetail.long.cents > 0 ? C.bad : C.ink }]}>{o.cash.overdueCents === null ? "sem dados" : brl(o.cash.overdueCents)}</Text>
              </View>
              {o.cash.overdueDetail ? (
                <Text style={[s.small, { marginBottom: 2 }]}>
                  {t(overdueSummary(o.cash.overdueDetail, brl))}.{o.cash.overdueDetail.short.cents > 0 ? " Atraso curto costuma ser pagamento ainda não baixado (extrato não lançado)." : ""}
                </Text>
              ) : null}
              <View style={s.line}>
                <Text style={s.small}>A vencer (todas as notas em aberto)</Text>
                <Text style={s.bold}>{o.cash.notDueCents === null ? "sem dados" : brl(o.cash.notDueCents)}</Text>
              </View>
            </View>
            <View style={s.card}>
              <Title>CAPEX e investimentos</Title>
              {!o.capex?.investment ? (
                <Empty>Sem lançamentos da tesouraria no mês.</Empty>
              ) : (
                <>
                  <View style={s.line}>
                    <Text style={s.small}>CAPEX do mês (saídas de investimento, como no Fluxo de caixa)</Text>
                    <Text style={s.bold}>{brl(o.capex.investment.totalCents)}</Text>
                  </View>
                  <Text style={s.small}>{o.capex.investment.deltaPct === null ? "sem comparação" : `${t(signedPct(o.capex.investment.deltaPct))} vs. ${fmtPeriod(prev)}`}</Text>
                  {o.capex.investment.partnerCardCents > 0 ? <Text style={[s.small, { marginTop: 2 }]}>Dos quais {brl(o.capex.investment.partnerCardCents)} pagos no cartão de sócios.</Text> : null}
                </>
              )}
              <View style={[s.line, { marginTop: 5 }]}>
                <Text style={s.small}>Aportes de investidores (não é receita)</Text>
                <Text style={s.bold}>{!o.investors?.current ? "sem dados" : brl(o.investors.current.totalCents)}</Text>
              </View>
            </View>
          </View>
        </View>
        <Footer o={o} meta={meta} />
      </Page>

      {/* 6 — Leitura executiva */}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header o={o} meta={meta} />
        <View style={[s.card, s.cardGap, { backgroundColor: C.cardHi, borderColor: C.brand }]}>
          <Text style={[s.h3, { color: C.brand }]}>O mês em uma frase</Text>
          <Text style={{ fontSize: 12, lineHeight: 1.5 }}>{t(o.reading) || "Sem dados suficientes para uma leitura do mês."}</Text>
        </View>
        <View style={[s.row, s.cardGap]}>
          <View style={[s.card, s.col]}>
            <Text style={[s.h3, { color: C.good }]}>O que foi bem</Text>
            {positives.length === 0 ? <Empty>Nenhum destaque positivo com os dados disponíveis.</Empty> : positives.map((i) => (
              <View key={i.id} style={{ marginBottom: 5 }} wrap={false}><Text style={s.bold}>{t(i.title)}</Text><Text style={s.small}>{t(i.detail)}</Text></View>
            ))}
          </View>
          <View style={[s.card, s.col]}>
            <Text style={[s.h3, { color: C.bad }]}>O que merece atenção</Text>
            {negatives.length === 0 ? <Empty>Nenhum ponto negativo com os dados disponíveis.</Empty> : negatives.map((i) => (
              <View key={i.id} style={{ marginBottom: 5 }} wrap={false}><Text style={s.bold}>{t(i.title)}</Text><Text style={s.small}>{t(i.detail)}</Text></View>
            ))}
          </View>
          <View style={[s.card, s.col]}>
            <Text style={[s.h3, { color: C.brand }]}>O que acompanhar no próximo mês</Text>
            {o.watchlist.length === 0 ? <Empty>Nenhum ponto de acompanhamento com os dados disponíveis.</Empty> : o.watchlist.map((w, n) => (
              <View key={w.id} style={{ marginBottom: 5 }} wrap={false}><Text style={s.bold}>{n + 1}. {t(w.title)}</Text><Text style={s.small}>Observação: {t(w.observation)}</Text></View>
            ))}
          </View>
        </View>
        <Text style={[s.small, { marginTop: 2 }]}>Dados que este resumo ainda não cobre:</Text>
        {o.limitations.map((l) => <Text key={l} style={[s.small, { fontSize: 6.8 }]}>· {t(l)}</Text>)}
        <Footer o={o} meta={meta} />
      </Page>
    </Document>
  );
}
