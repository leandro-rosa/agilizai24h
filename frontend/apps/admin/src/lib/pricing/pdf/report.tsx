import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { date, period as fmtPeriod } from "@/lib/format";

import type { ExportModel } from "../export-model";
import { CONFIDENCE_LABEL, STATUS_LABEL } from "../labels";

export interface PricingReportMeta {
  generatedAt: string;
  /** URL absoluta do logotipo (`/brand/lockup-dark.png`); sem ela o cabeçalho usa só o texto. */
  logoSrc?: string;
}

/** A fonte padrão (Helvetica) não tem "−", setas nem "≥": troca por equivalentes seguros em vez de exibir lixo. */
const t = (s: string) => s.replace(/−/g, "-").replace(/→/g, "->").replace(/≥/g, ">=").replace(/…/g, "...").replace(/\u00a0/g, " ").replace(/\s{2,}/g, " ").trim();
const brl = (c: number | null | undefined) => (c === null || c === undefined ? "-" : t(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Math.round(c) / 100)));
const pct = (v: number | null, d = 1) => (v === null ? "-" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const pp = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v * 100).toFixed(1).replace(".", ",")} p.p.`);
const signedBrl = (c: number | null) => (c === null ? "-" : `${c > 0 ? "+ " : c < 0 ? "- " : ""}${brl(Math.abs(c))}`);

/** Mesma paleta do painel escuro (`globals.css .dark`) e do PDF do Resumo Mensal. */
const C = { bg: "#150f17", card: "#201826", border: "#3a2c42", ink: "#fff4e6", muted: "#a89e97", brand: "#e91e8c", brandSoft: "#4a1537", good: "#3fbf83", bad: "#ff736a", warn: "#e89b3c" };

const s = StyleSheet.create({
  page: { paddingTop: 20, paddingBottom: 32, paddingHorizontal: 28, fontSize: 9, fontFamily: "Helvetica", color: C.ink, backgroundColor: C.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  logo: { height: 28, width: 92 },
  logoText: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.brand },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 8.5, color: C.muted, marginTop: 2 },
  meta: { fontSize: 7.5, color: C.muted, textAlign: "right", marginBottom: 1.5 },
  row: { flexDirection: "row", gap: 8 },
  card: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, marginBottom: 8 },
  h2: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 6, marginTop: 4 },
  label: { fontSize: 8.5, color: C.muted },
  value: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 3 },
  small: { fontSize: 8, color: C.muted },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 3, marginBottom: 3 },
  thText: { fontSize: 7.5, color: C.muted, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: C.border },
  footer: { position: "absolute", bottom: 14, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: C.muted },
});

function Header({ model, meta }: { model: ExportModel; meta: PricingReportMeta }) {
  return (
    <View style={s.header}>
      <View>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf não tem alt */}
        {meta.logoSrc ? <Image src={meta.logoSrc} style={s.logo} /> : <Text style={s.logoText}>agiliz.ai</Text>}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={s.title}>Precificação Inteligente</Text>
        <Text style={s.sub}>
          {t(fmtPeriod(model.period))} · {t(model.scopeLabel)}
        </Text>
      </View>
    </View>
  );
}

function Footer({ model, meta }: { model: ExportModel; meta: PricingReportMeta }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        Motor {model.engineVersion} · regras v{model.parameterVersion} · gerado em {date(meta.generatedAt)}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={s.card}>
      <Text style={s.label}>{t(label)}</Text>
      <Text style={s.value}>{t(value)}</Text>
      {hint && <Text style={s.small}>{t(hint)}</Text>}
    </View>
  );
}

function Cols({ widths, cells, header = false }: { widths: number[]; cells: string[]; header?: boolean }) {
  return (
    <View style={header ? s.th : s.tr}>
      {cells.map((cell, index) => (
        <Text key={index} style={[header ? s.thText : {}, { width: `${widths[index]}%` }]}>
          {t(cell)}
        </Text>
      ))}
    </View>
  );
}

/**
 * O PDF da precificação, gerado do mesmo modelo que a tela e o Excel usam (não é um print da tela): período, margem média,
 * abaixo da meta, oportunidades, custos alterados, preços recomendados com o impacto — sempre "Impacto potencial estimado" — e
 * as observações sobre a qualidade dos dados.
 */
export function PricingReport({ model, meta }: { model: ExportModel; meta: PricingReportMeta }) {
  const { summary } = model;
  const gap = summary.averageMargin === null ? null : summary.averageMargin - summary.targetMargin;
  const recommended = model.products.filter((product) => product.recommendedPriceCents !== null).sort((a, b) => (b.impactCentsPerMonth ?? 0) - (a.impactCentsPerMonth ?? 0)).slice(0, 25);

  return (
    <Document title={`Precificação Inteligente ${model.period}`} author="Agiliz.AI">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header model={model} meta={meta} />
        <Text style={s.small}>Filtros: {t(model.filtersLabel)}</Text>

        <View style={[s.row, { marginTop: 8 }]}>
          <Kpi label="Margem média do mix" value={pct(summary.averageMargin)} hint={`Meta ${pct(summary.targetMargin, 0)}${gap === null ? "" : ` · ${pp(gap)}`}`} />
          <Kpi label="Produtos dentro da meta" value={String(summary.withinTarget)} hint={`${pct(summary.shares.withinTarget, 0)} do catálogo analisado`} />
          <Kpi label="Produtos abaixo da meta" value={String(summary.belowTarget)} hint={`${pct(summary.shares.belowTarget, 0)} dos produtos`} />
          <Kpi label="Sem custo confiável" value={String(summary.insufficientData)} hint="Sem recomendação automática" />
          <Kpi label="Impacto potencial (mês)" value={signedBrl(summary.potentialImpactCentsPerMonth)} hint={model.impactLabel} />
        </View>

        <Text style={s.h2}>Principais oportunidades de precificação</Text>
        {model.opportunities.length === 0 ? (
          <Text style={s.small}>Nenhuma oportunidade neste recorte.</Text>
        ) : (
          model.opportunities.map(({ product, text }) => (
            <View key={product.sku} style={{ marginBottom: 4 }} wrap={false}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{t(product.name ?? product.sku)}</Text>
              <Text style={s.small}>{t(text)}</Text>
            </View>
          ))
        )}
        <Footer model={model} meta={meta} />
      </Page>

      <Page size="A4" orientation="landscape" style={s.page}>
        <Header model={model} meta={meta} />

        <Text style={s.h2}>Produtos abaixo da meta</Text>
        <Cols header widths={[30, 14, 14, 14, 14, 14]} cells={["Produto", "Margem atual", "Preço atual", "Recomendado", "Impacto (mês)", "Confiança"]} />
        {model.belowTarget.slice(0, 15).map((product) => (
          <Cols key={product.sku} widths={[30, 14, 14, 14, 14, 14]} cells={[product.name ?? product.sku, pct(product.currentMargin), brl(product.currentPriceCents), brl(product.recommendedPriceCents), signedBrl(product.impactCentsPerMonth), CONFIDENCE_LABEL[product.confidence]]} />
        ))}
        {model.belowTarget.length === 0 && <Text style={s.small}>Nenhum produto abaixo da meta com recomendação.</Text>}

        <Text style={s.h2}>Custos que mais mudaram</Text>
        <Cols header widths={[34, 16, 16, 14, 20]} cells={["Produto", "Custo anterior", "Custo atual", "Variação", "Margem (p.p.)"]} />
        {model.costChanges.map((row) => (
          <Cols key={row.product.sku} widths={[34, 16, 16, 14, 20]} cells={[row.product.name ?? row.product.sku, brl(row.previousCostCents), brl(row.currentCostCents), `${row.variation > 0 ? "+" : "-"}${pct(Math.abs(row.variation))}`, pp(row.marginChange)]} />
        ))}
        {model.costChanges.length === 0 && <Text style={s.small}>Nenhuma alteração de custo neste recorte.</Text>}
        <Footer model={model} meta={meta} />
      </Page>

      <Page size="A4" orientation="landscape" style={s.page}>
        <Header model={model} meta={meta} />
        <Text style={s.h2}>Preços recomendados e impacto potencial estimado</Text>
        <Cols header widths={[28, 12, 12, 12, 12, 12, 12]} cells={["Produto", "Preço atual", "Mínimo", "Meta", "Recomendado", "Impacto (mês)", "Situação"]} />
        {recommended.map((product) => (
          <Cols key={product.sku} widths={[28, 12, 12, 12, 12, 12, 12]} cells={[product.name ?? product.sku, brl(product.currentPriceCents), brl(product.minimumPriceCents), brl(product.targetPriceCents), brl(product.recommendedPriceCents), signedBrl(product.impactCentsPerMonth), STATUS_LABEL[product.status]]} />
        ))}
        {recommended.length === 0 && <Text style={s.small}>Nenhum produto com preço recomendado neste recorte.</Text>}
        <Text style={[s.small, { marginTop: 6 }]}>{model.impactLabel}: não é lucro garantido; supõe o volume atual constante.</Text>

        <Text style={s.h2}>Observações sobre a qualidade dos dados</Text>
        {model.notes.length === 0 ? <Text style={s.small}>Nenhuma lacuna relevante nos dados deste cálculo.</Text> : model.notes.map((note) => <Text key={note} style={{ marginBottom: 3 }}>- {t(note)}</Text>)}
        <Footer model={model} meta={meta} />
      </Page>
    </Document>
  );
}
