import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Settlement } from "@/lib/api/purchases";
import { formatCents, formatDate } from "./money";

/** A fonte padrão (Helvetica) não tem o travessão longo nem o espaço sem quebra: troca por equivalentes seguros. */
const t = (s: string) => s.replace(/\u2014/g, "-").replace(/\u2013/g, "-").replace(/\u00a0/g, " ").replace(/\u00d7/g, "x");

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(0, 4)}`;

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#222" },
  title: { fontSize: 16, marginBottom: 2, fontFamily: "Helvetica-Bold" },
  muted: { color: "#666", marginBottom: 10 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 4 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#222", paddingVertical: 3, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ccc", paddingVertical: 3 },
  product: { flex: 1 },
  c1: { width: 58, textAlign: "right" },
  c2: { width: 64, textAlign: "right" },
  c3: { width: 74, textAlign: "right" },
  sum: { marginTop: 4, textAlign: "right", fontFamily: "Helvetica-Bold" },
  total: { marginTop: 14, textAlign: "right", fontSize: 13, fontFamily: "Helvetica-Bold" },
  note: { marginTop: 4, color: "#666", fontSize: 8 },
});

/**
 * O fechamento confirmado, para mandar ao fornecedor. Tudo vem do que ficou GRAVADO na confirmação (vendas, escolhas e a foto do que sobrou),
 * então o PDF é sempre igual, qualquer dia em que for gerado. O estoque em casa é o que a pessoa informou; o das lojas é o saldo da última visita.
 */
export function ClosingPdf({ settlement }: { settlement: Settlement }) {
  const ev = settlement.evidence;
  const lines = ev.closing_lines ?? [];
  const extras = ev.extras ?? [];
  const removals = (ev.removals_snapshot?.lines ?? []).filter((l) => l.expired.units + l.other_reason.units + l.returned.units > 0);
  const stock = ev.stock ?? null;
  const home = new Map((ev.home_stock ?? []).map((h) => [h.sku, h.units]));
  const soldTotal = lines.reduce((s, l) => s + l.total_cents, 0);
  const extrasTotal = extras.reduce((s, e) => s + e.total_cents, 0);
  const stockRows = (stock ?? []).filter((l) => l.in_stores !== null || home.has(l.sku));
  const lastVisit = stockRows.map((l) => l.last_visit).filter((d): d is string => d !== null).sort().at(-1) ?? null;

  return (
    <Document title={`Fechamento ${settlement.supplier_name ?? ""} ${settlement.period_from} a ${settlement.period_to}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{t("Fechamento de consignação")}</Text>
        <Text style={styles.muted}>
          {t(`Agiliz.AI - Fornecedor: ${settlement.supplier_name ?? ""} - Período: ${formatDate(settlement.period_from)} a ${formatDate(settlement.period_to)}`)}
          {settlement.state === "paid" ? t(` - Pago em ${formatDate(settlement.paid_on)}`) : ""}
        </Text>

        <Text style={styles.h2}>Vendas e repasse</Text>
        <View style={styles.head}>
          <Text style={styles.product}>Produto</Text>
          <Text style={styles.c1}>Vendidas</Text>
          <Text style={styles.c2}>Custo</Text>
          <Text style={styles.c3}>Repasse</Text>
        </View>
        {lines.map((l) => (
          <View key={l.sku} style={styles.row} wrap={false}>
            <Text style={styles.product}>{t(l.name)}</Text>
            <Text style={styles.c1}>{l.sold_units}</Text>
            <Text style={styles.c2}>{t(formatCents(l.unit_cost_cents))}</Text>
            <Text style={styles.c3}>{t(formatCents(l.total_cents))}</Text>
          </View>
        ))}
        <Text style={styles.sum}>{t(`Subtotal vendido: ${formatCents(soldTotal)}`)}</Text>

        {extras.length > 0 && (
          <View>
            <Text style={styles.h2}>Vencidas e outro motivo incluídas neste fechamento</Text>
            <View style={styles.head}>
              <Text style={styles.product}>Produto</Text>
              <Text style={styles.c2}>Mês</Text>
              <Text style={styles.c2}>Tipo</Text>
              <Text style={styles.c1}>Un.</Text>
              <Text style={styles.c3}>Valor</Text>
            </View>
            {extras.map((e) => (
              <View key={`${e.sku}-${e.month}-${e.kind}`} style={styles.row} wrap={false}>
                <Text style={styles.product}>{t(e.name)}</Text>
                <Text style={styles.c2}>{t(monthName(e.month))}</Text>
                <Text style={styles.c2}>{e.kind === "expired" ? "Vencidas" : "Outro motivo"}</Text>
                <Text style={styles.c1}>{e.units}</Text>
                <Text style={styles.c3}>{t(formatCents(e.total_cents))}</Text>
              </View>
            ))}
            <Text style={styles.sum}>{t(`Subtotal vencidas e outro motivo: ${formatCents(extrasTotal)}`)}</Text>
          </View>
        )}

        <Text style={styles.total}>{t(`Total do fechamento: ${formatCents(settlement.owed_cents)}`)}</Text>

        {removals.length > 0 && (
          <View>
            <Text style={styles.h2}>Retiradas das lojas no período (informativo)</Text>
            <View style={styles.head}>
              <Text style={styles.product}>Produto</Text>
              <Text style={styles.c2}>Mês</Text>
              <Text style={styles.c1}>Vencidas</Text>
              <Text style={styles.c2}>Outro motivo</Text>
              <Text style={styles.c1}>Devolvidas</Text>
            </View>
            {removals.map((l) => (
              <View key={`${l.sku}-${l.month}`} style={styles.row} wrap={false}>
                <Text style={styles.product}>{t(l.name)}</Text>
                <Text style={styles.c2}>{t(monthName(l.month))}</Text>
                <Text style={styles.c1}>{l.expired.units}</Text>
                <Text style={styles.c2}>{l.other_reason.units}</Text>
                <Text style={styles.c1}>{l.returned.units}</Text>
              </View>
            ))}
            <Text style={styles.note}>{t("O abastecimento registra as retiradas por mês. Só entra no total acima o que está listado em “incluídas neste fechamento”.")}</Text>
          </View>
        )}

        {stock && stockRows.length > 0 && (
          <View>
            <Text style={styles.h2}>O que sobrou de cada item</Text>
            <View style={styles.head}>
              <Text style={styles.product}>Produto</Text>
              <Text style={styles.c1}>Nas lojas</Text>
              <Text style={styles.c1}>Em casa</Text>
              <Text style={styles.c1}>Total</Text>
              <Text style={styles.c2}>Vendidas/dia</Text>
            </View>
            {stockRows.map((l) => (
              <View key={l.sku} style={styles.row} wrap={false}>
                <Text style={styles.product}>{t(l.name)}</Text>
                <Text style={styles.c1}>{l.in_stores === null ? "-" : l.in_stores}</Text>
                <Text style={styles.c1}>{home.has(l.sku) ? home.get(l.sku) : "-"}</Text>
                <Text style={styles.c1}>{l.in_stores === null && !home.has(l.sku) ? "-" : (l.in_stores ?? 0) + (home.get(l.sku) ?? 0)}</Text>
                <Text style={styles.c2}>{l.per_day === null ? "-" : String(l.per_day).replace(".", ",")}</Text>
              </View>
            ))}
            <Text style={styles.note}>
              {t(`Nas lojas: saldo após a última visita de cada loja${lastVisit ? ` (a mais recente em ${formatDate(lastVisit)})` : ""}. Em casa: quantidade informada pelo Agiliz no fechamento. "-" = sem registro.`)}
            </Text>
          </View>
        )}
      </Page>
    </Document>
  );
}

/** O PDF do fechamento como arquivo. O renderizador é carregado só aqui, no clique. */
export async function closingPdfBlob(settlement: Settlement): Promise<Blob> {
  const { pdf } = await import("@react-pdf/renderer");

  return pdf(<ClosingPdf settlement={settlement} />).toBlob();
}
