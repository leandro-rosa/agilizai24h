import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Settlement } from "@/lib/api/purchases";
import { formatCents, formatDate } from "./money";

/** A fonte padrão (Helvetica) não tem o travessão longo nem o espaço sem quebra: troca por equivalentes seguros. */
const t = (s: string) => s.replace(/\u2014/g, "-").replace(/\u2013/g, "-").replace(/\u00a0/g, " ").replace(/\u00d7/g, "x");

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(0, 4)}`;


/** Cores da marca (BRAND.md): Magenta Framboesa, Carvão, Creme Quente, o magenta de destaque e o roxo do gradiente. */
const C = { magenta: "#8E1D4D", ink: "#1F1F1F", cream: "#FFF4E6", pink: "#E91E8C", purple: "#5B2D8E", line: "#E6D8C8", muted: "#6B6B6B" };

const styles = StyleSheet.create({
  page: { paddingBottom: 42, fontSize: 8.5, fontFamily: "Helvetica", color: C.ink },
  band: { backgroundColor: C.ink, paddingHorizontal: 28, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  accent: { height: 4, backgroundColor: C.pink },
  logo: { width: 120, height: 34, objectFit: "contain" },
  logoText: { color: "#fff", fontSize: 16, fontFamily: "Helvetica-Bold" },
  bandRight: { alignItems: "flex-end" },
  title: { color: "#fff", fontSize: 15, fontFamily: "Helvetica-Bold" },
  bandSub: { color: "#E9D5DF", fontSize: 9, marginTop: 2 },
  body: { paddingHorizontal: 28, paddingTop: 14 },
  h2: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: C.magenta, marginTop: 12, marginBottom: 5 },
  cards: { flexDirection: "row" },
  card: { flex: 1, borderWidth: 0.8, borderColor: C.line, borderRadius: 5, padding: 8, marginRight: 8, backgroundColor: C.cream },
  cardHot: { flex: 1.25, borderRadius: 5, padding: 8, backgroundColor: C.magenta },
  cardLabel: { fontSize: 7.5, color: C.muted },
  cardLabelHot: { fontSize: 7.5, color: "#F6D4E3" },
  cardValue: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 2 },
  cardValueHot: { fontSize: 17, fontFamily: "Helvetica-Bold", marginTop: 2, color: "#fff" },
  cardNote: { fontSize: 7, color: C.muted, marginTop: 2 },
  cardNoteHot: { fontSize: 7, color: "#F6D4E3", marginTop: 2 },
  head: { flexDirection: "row", fontFamily: "Helvetica-Bold", color: "#fff" },
  th: { paddingVertical: 4, paddingHorizontal: 4, backgroundColor: C.magenta },
  thStock: { paddingVertical: 4, paddingHorizontal: 4, backgroundColor: C.purple },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line },
  zebra: { backgroundColor: "#FFFAF3" },
  td: { paddingVertical: 3.5, paddingHorizontal: 4 },
  tdStock: { paddingVertical: 3.5, paddingHorizontal: 4, backgroundColor: "#F5EFFA" },
  totalRow: { flexDirection: "row", backgroundColor: C.cream, borderTopWidth: 1, borderTopColor: C.magenta, fontFamily: "Helvetica-Bold" },
  product: { flex: 1 },
  num: { width: 52, textAlign: "right" },
  numWide: { width: 66, textAlign: "right" },
  money: { width: 68, textAlign: "right" },
  note: { marginTop: 5, color: C.muted, fontSize: 7.5 },
  footer: { position: "absolute", left: 28, right: 28, bottom: 16, flexDirection: "row", justifyContent: "space-between", color: C.muted, fontSize: 7.5 },
});

type Row = { sku: string; name: string; cost: number | null; sold: number; repasse: number; expired: number; other: number; inStores: number | null; home: number | null };

/**
 * O fechamento confirmado, para mandar ao fornecedor, no desenho da planilha dele: uma linha por produto com custo, quantidade vendida, repasse e o que
 * sobrou (as colunas roxas). Tudo vem do que ficou GRAVADO na confirmação (vendas, escolhas, retiradas, foto do que sobrou), então o PDF é igual em
 * qualquer dia em que for gerado. O estoque em casa é o que a pessoa informou; o das lojas é o saldo da última visita de cada loja.
 */
export function ClosingPdf({ settlement, logoSrc }: { settlement: Settlement; logoSrc?: string }) {
  const ev = settlement.evidence;
  const lines = ev.closing_lines ?? [];
  const extras = ev.extras ?? [];
  const stock = ev.stock ?? null;
  const home = new Map((ev.home_stock ?? []).map((h) => [h.sku, h.units]));
  const removalLines = ev.removals_snapshot?.lines ?? [];
  const soldTotal = lines.reduce((s, l) => s + l.total_cents, 0);
  const soldUnits = lines.reduce((s, l) => s + l.sold_units, 0);
  const expiredIncluded = extras.filter((e) => e.kind === "expired").reduce((s, e) => s + e.total_cents, 0);
  const otherIncluded = extras.filter((e) => e.kind === "other_reason").reduce((s, e) => s + e.total_cents, 0);

  const names = new Map<string, string>();
  for (const l of lines) names.set(l.sku, l.name);
  for (const l of stock ?? []) names.set(l.sku, names.get(l.sku) ?? l.name);
  for (const l of removalLines) names.set(l.sku, names.get(l.sku) ?? l.name);
  const rows: Row[] = [...names.keys()]
    .map((sku) => {
      const sale = lines.find((l) => l.sku === sku);
      const st = (stock ?? []).find((l) => l.sku === sku);
      const rem = removalLines.filter((l) => l.sku === sku);
      const extra = extras.find((e) => e.sku === sku);
      const unitFromRemoval = rem.map((l) => (l.expired.units > 0 && l.expired.cents !== null ? l.expired.cents / l.expired.units : l.other_reason.units > 0 && l.other_reason.cents !== null ? l.other_reason.cents / l.other_reason.units : null)).find((c) => c !== null) ?? null;

      return {
        sku,
        name: names.get(sku) as string,
        cost: sale?.unit_cost_cents ?? extra?.unit_cost_cents ?? unitFromRemoval,
        sold: sale?.sold_units ?? 0,
        repasse: sale?.total_cents ?? 0,
        expired: rem.reduce((n, l) => n + l.expired.units, 0),
        other: rem.reduce((n, l) => n + l.other_reason.units, 0),
        inStores: st?.in_stores ?? null,
        home: home.get(sku) ?? null,
      };
    })
    .filter((r) => r.sold > 0 || r.expired > 0 || r.other > 0 || (r.inStores ?? 0) > 0 || (r.home ?? 0) > 0)
    .sort((a, b) => b.repasse - a.repasse || a.name.localeCompare(b.name, "pt-BR"));
  const lastVisit = (stock ?? []).map((l) => l.last_visit).filter((d): d is string => d !== null).sort().at(-1) ?? null;
  const stockTotal = (r: Row) => (r.inStores === null && r.home === null ? null : (r.inStores ?? 0) + (r.home ?? 0));
  const sum = (pick: (r: Row) => number | null) => rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
  const dash = (v: number | null) => (v === null ? "-" : String(v));

  return (
    <Document title={`Fechamento ${settlement.supplier_name ?? ""} ${settlement.period_from} a ${settlement.period_to}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.band}>
          {logoSrc ? <Image src={logoSrc} style={styles.logo} /> : <Text style={styles.logoText}>agiliz.ai</Text>}
          <View style={styles.bandRight}>
            <Text style={styles.title}>{t("Fechamento de consignação")}</Text>
            <Text style={styles.bandSub}>{t(`${settlement.supplier_name ?? ""}  |  ${formatDate(settlement.period_from)} a ${formatDate(settlement.period_to)}${settlement.state === "paid" ? `  |  Pago em ${formatDate(settlement.paid_on)}` : ""}`)}</Text>
          </View>
        </View>
        <View style={styles.accent} />

        <View style={styles.body}>
          <Text style={[styles.h2, { marginTop: 0 }]}>Resumo do repasse</Text>
          <View style={styles.cards}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Vendido no período</Text>
              <Text style={styles.cardValue}>{t(formatCents(soldTotal))}</Text>
              <Text style={styles.cardNote}>{soldUnits} unidades x custo de repasse</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Vencidas incluídas</Text>
              <Text style={styles.cardValue}>{t(formatCents(expiredIncluded))}</Text>
              <Text style={styles.cardNote}>{extras.filter((e) => e.kind === "expired").reduce((n, e) => n + e.units, 0)} unidades</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Outro motivo incluído</Text>
              <Text style={styles.cardValue}>{t(formatCents(otherIncluded))}</Text>
              <Text style={styles.cardNote}>{extras.filter((e) => e.kind === "other_reason").reduce((n, e) => n + e.units, 0)} unidades</Text>
            </View>
            <View style={[styles.cardHot, { marginRight: 0 }]}>
              <Text style={styles.cardLabelHot}>Total a repassar</Text>
              <Text style={styles.cardValueHot}>{t(formatCents(settlement.owed_cents))}</Text>
              <Text style={styles.cardNoteHot}>{settlement.state === "paid" ? t(`Pago em ${formatDate(settlement.paid_on)}`) : "Confirmado, a pagar"}</Text>
            </View>
          </View>

          <Text style={styles.h2}>Produtos</Text>
          <View style={styles.head}>
            <Text style={[styles.th, styles.product]}>Produto</Text>
            <Text style={[styles.th, styles.money]}>Custo</Text>
            <Text style={[styles.th, styles.num]}>Vendidas</Text>
            <Text style={[styles.th, styles.money]}>Repasse</Text>
            <Text style={[styles.th, styles.num]}>Vencidas</Text>
            <Text style={[styles.th, styles.numWide]}>Outro motivo</Text>
            <Text style={[styles.thStock, styles.num]}>Nas lojas</Text>
            <Text style={[styles.thStock, styles.num]}>Em casa</Text>
            <Text style={[styles.thStock, styles.num]}>Estoque</Text>
          </View>
          {rows.map((r, i) => (
            <View key={r.sku} style={[styles.row, i % 2 === 1 ? styles.zebra : {}]} wrap={false}>
              <Text style={[styles.td, styles.product]}>{t(r.name)}</Text>
              <Text style={[styles.td, styles.money]}>{r.cost === null ? "-" : t(formatCents(Math.round(r.cost)))}</Text>
              <Text style={[styles.td, styles.num]}>{r.sold}</Text>
              <Text style={[styles.td, styles.money]}>{t(formatCents(r.repasse))}</Text>
              <Text style={[styles.td, styles.num]}>{r.expired || "-"}</Text>
              <Text style={[styles.td, styles.numWide]}>{r.other || "-"}</Text>
              <Text style={[styles.tdStock, styles.num]}>{dash(r.inStores)}</Text>
              <Text style={[styles.tdStock, styles.num]}>{dash(r.home)}</Text>
              <Text style={[styles.tdStock, styles.num]}>{dash(stockTotal(r))}</Text>
            </View>
          ))}
          <View style={styles.totalRow} wrap={false}>
            <Text style={[styles.td, styles.product]}>Total</Text>
            <Text style={[styles.td, styles.money]} />
            <Text style={[styles.td, styles.num]}>{sum((r) => r.sold)}</Text>
            <Text style={[styles.td, styles.money]}>{t(formatCents(sum((r) => r.repasse)))}</Text>
            <Text style={[styles.td, styles.num]}>{sum((r) => r.expired)}</Text>
            <Text style={[styles.td, styles.numWide]}>{sum((r) => r.other)}</Text>
            <Text style={[styles.td, styles.num]}>{sum((r) => r.inStores)}</Text>
            <Text style={[styles.td, styles.num]}>{sum((r) => r.home)}</Text>
            <Text style={[styles.td, styles.num]}>{sum((r) => stockTotal(r))}</Text>
          </View>
          <Text style={styles.note}>
            {t(`Vencidas e outro motivo: unidades retiradas das lojas nos meses do período (o abastecimento registra por mês). Só entra no total o que está em “Incluído no total”. Nas lojas: saldo após a última visita de cada loja${lastVisit ? ` (a mais recente em ${formatDate(lastVisit)})` : ""}. Em casa: informado pelo Agiliz no fechamento. “-” = sem registro.`)}
          </Text>

          {extras.length > 0 && (
            <View wrap={false}>
              <Text style={styles.h2}>Incluído no total (vencidas e outro motivo)</Text>
              <View style={styles.head}>
                <Text style={[styles.th, styles.product]}>Produto</Text>
                <Text style={[styles.th, styles.money]}>Mês</Text>
                <Text style={[styles.th, styles.money]}>Tipo</Text>
                <Text style={[styles.th, styles.num]}>Un.</Text>
                <Text style={[styles.th, styles.money]}>Valor</Text>
              </View>
              {extras.map((e, i) => (
                <View key={`${e.sku}-${e.month}-${e.kind}`} style={[styles.row, i % 2 === 1 ? styles.zebra : {}]}>
                  <Text style={[styles.td, styles.product]}>{t(e.name)}</Text>
                  <Text style={[styles.td, styles.money]}>{t(monthName(e.month))}</Text>
                  <Text style={[styles.td, styles.money]}>{e.kind === "expired" ? "Vencidas" : "Outro motivo"}</Text>
                  <Text style={[styles.td, styles.num]}>{e.units}</Text>
                  <Text style={[styles.td, styles.money]}>{t(formatCents(e.total_cents))}</Text>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={[styles.td, styles.product]}>Subtotal</Text>
                <Text style={[styles.td, styles.money]} />
                <Text style={[styles.td, styles.money]} />
                <Text style={[styles.td, styles.num]}>{extras.reduce((n, e) => n + e.units, 0)}</Text>
                <Text style={[styles.td, styles.money]}>{t(formatCents(expiredIncluded + otherIncluded))}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>{t("Agiliz.AI - Sua rotina é rápida. A gente também.")}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** O PDF do fechamento como arquivo. O renderizador é carregado só aqui, no clique. */
export async function closingPdfBlob(settlement: Settlement): Promise<Blob> {
  const { pdf } = await import("@react-pdf/renderer");

  // O logotipo é o do painel (lockup para fundo escuro, por isso a faixa carvão no topo); sem ele o cabeçalho usa só o texto.
  const logoSrc = typeof window === "undefined" ? undefined : `${window.location.origin}/brand/lockup-dark.png`;

  return pdf(<ClosingPdf settlement={settlement} logoSrc={logoSrc} />).toBlob();
}
