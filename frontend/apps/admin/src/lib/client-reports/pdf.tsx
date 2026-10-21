import { Defs, Document, Image, LinearGradient, Page, Rect, Stop, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";

import type { ClientDivergenceReport, ClientDivergenceUnit } from "@/lib/api/client-reports";
import { PERIOD_NOTE, PRICE_NOTE, REPORT_TITLE, formatInstant, lossText, partialNote, periodText, priceText, totalText, unitsText, unitsWithRows } from "./model";

/** The default font has no em dash or non-breaking space: swap for safe equivalents. */
const t = (s: string) => s.replace(/\u2014/g, "-").replace(/\u2013/g, "-").replace(/\u00a0/g, " ");

/** Brand tokens (frontend/docs/BRAND.md): Magenta Framboesa (primary), the digital magenta and the purple (the one the manual flags as sampled). The band runs purple to Framboesa; BRAND.md's own #E91E8C to #5B2D8E gradient is the icon one and is not used here. The lilac tint is the one the supplier closing already uses. */
const C = { magenta: "#8E1D4D", pink: "#E91E8C", purple: "#5B2D8E", ink: "#1F1F1F", lilac: "#F5EFFA", lilacHead: "#E8DEF3", line: "#E6D8C8", muted: "#6B6B6B" };

const MARGIN = 28;
const s = StyleSheet.create({
  page: { paddingBottom: 40, fontSize: 9, fontFamily: "Helvetica", color: C.ink },
  band: { height: 76, position: "relative", overflow: "hidden" },
  bandBg: { position: "absolute", left: 0, top: 0 },
  contour: { position: "absolute", left: 0, top: -60, width: 842, height: 481, opacity: 0.5 },
  bandRow: { flexDirection: "row", alignItems: "center", height: 76, paddingHorizontal: MARGIN },
  logo: { width: 112, height: 34, objectFit: "contain" },
  logoText: { color: "#fff", fontSize: 18, fontFamily: "Helvetica-Bold" },
  divider: { width: 1, height: 36, backgroundColor: "#ffffff88", marginHorizontal: 16 },
  title: { color: "#fff", fontSize: 20, fontFamily: "Helvetica-Bold" },
  info: { flexDirection: "row", alignItems: "baseline", paddingHorizontal: MARGIN, paddingTop: 12 },
  infoLabel: { fontSize: 10, color: C.muted },
  infoValue: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginLeft: 4 },
  infoSep: { width: 1, height: 14, backgroundColor: C.line, marginHorizontal: 14, alignSelf: "center" },
  periodNote: { paddingHorizontal: MARGIN, paddingTop: 3, paddingBottom: 8, fontSize: 8, color: C.muted },
  table: { paddingHorizontal: MARGIN },
  headRow: { flexDirection: "row" },
  th: { backgroundColor: C.purple, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8.5, paddingVertical: 5, paddingHorizontal: 5, justifyContent: "center", borderRightWidth: 0.6, borderRightColor: "#ffffff55" },
  thSub: { backgroundColor: C.lilacHead, color: C.purple, fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 4, paddingHorizontal: 5, justifyContent: "center", borderRightWidth: 0.6, borderRightColor: "#ffffff" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line },
  td: { paddingVertical: 4, paddingHorizontal: 5, justifyContent: "center" },
  tdTint: { backgroundColor: C.lilac },
  sku: { fontSize: 7, color: C.muted, marginTop: 1 },
  totalRow: { flexDirection: "row", backgroundColor: C.purple, color: "#fff", fontFamily: "Helvetica-Bold" },
  noteBox: { marginTop: 10, marginHorizontal: MARGIN, backgroundColor: C.lilac, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 10, fontSize: 8.5, color: C.purple, fontFamily: "Helvetica-Bold" },
  note: { marginTop: 6, marginHorizontal: MARGIN, fontSize: 8, color: C.muted },
  empty: { marginTop: 40, textAlign: "center", fontSize: 12, color: C.muted },
  footer: { position: "absolute", left: MARGIN, right: MARGIN, bottom: 14, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.pink, paddingTop: 5, fontSize: 8, color: C.muted },
});

const W = { product: { flexGrow: 1, flexBasis: 0 }, qty: { width: 78 }, prev: { width: 112 }, found: { width: 112 }, price: { width: 96 }, loss: { width: 100 } };
const right = { textAlign: "right" as const };

export interface ClientReportPdfProps {
  report: ClientDivergenceReport;
  /** Absolute URL of the official white lockup (`/brand/lockup-dark.png`). Without it the band falls back to the wordmark as text. */
  logoSrc?: string;
  /** Absolute URL of the official contour pattern rendered to PNG (`/brand/contour.png`). Optional. */
  contourSrc?: string;
  /** DD/MM/AAAA, the day the document was issued. */
  issuedOn: string;
}

function Band({ logoSrc, contourSrc }: Pick<ClientReportPdfProps, "logoSrc" | "contourSrc">) {
  return (
    <View style={s.band} fixed>
      <Svg width={842} height={76} style={s.bandBg}>
        <Defs>
          <LinearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.purple} />
            <Stop offset="1" stopColor={C.magenta} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={842} height={76} fill="url(#brand)" />
      </Svg>
      {contourSrc ? <Image src={contourSrc} style={s.contour} /> : null}
      <View style={s.bandRow}>
        {logoSrc ? <Image src={logoSrc} style={s.logo} /> : <Text style={s.logoText}>agiliz.ai</Text>}
        <View style={s.divider} />
        <Text style={s.title}>{REPORT_TITLE}</Text>
      </View>
    </View>
  );
}

function Info({ report, unit }: { report: ClientDivergenceReport; unit?: ClientDivergenceUnit }) {
  return (
    <View fixed>
      <View style={s.info}>
        <Text style={s.infoLabel}>Cliente:</Text>
        <Text style={s.infoValue}>{t(report.client.name)}</Text>
        {unit ? (
          <>
            <View style={s.infoSep} />
            <Text style={s.infoLabel}>Unidade:</Text>
            <Text style={s.infoValue}>{t(unit.code)}</Text>
          </>
        ) : null}
        <View style={s.infoSep} />
        <Text style={s.infoLabel}>Período consultado:</Text>
        <Text style={s.infoValue}>{periodText(report)}</Text>
      </View>
      <Text style={s.periodNote}>{PERIOD_NOTE}</Text>
    </View>
  );
}

function Footer({ issuedOn }: { issuedOn: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>agiliz.ai • Emitido em {issuedOn}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function ColumnHeaders() {
  return (
    <View fixed style={s.table}>
      <View style={s.headRow}>
        <View style={[s.th, W.product, { justifyContent: "flex-end" }]}><Text>Produto</Text></View>
        <View style={[s.th, W.qty]}><Text style={right}>Quantidade em falta</Text></View>
        <View style={[W.prev, { width: 224 }]}>
          <View style={[s.th, { alignItems: "center" }]}><Text>Período da divergência</Text></View>
          <View style={s.headRow}>
            <View style={[s.thSub, W.prev]}><Text>Conferência anterior</Text></View>
            <View style={[s.thSub, W.found]}><Text>Falta identificada em</Text></View>
          </View>
        </View>
        <View style={[s.th, W.price]}><Text style={right}>Preço de venda unitário</Text></View>
        <View style={[s.th, W.loss]}><Text style={right}>Valor da perda</Text></View>
      </View>
    </View>
  );
}

function UnitPage({ report, unit, issuedOn, logoSrc, contourSrc }: { report: ClientDivergenceReport; unit: ClientDivergenceUnit } & ClientReportPdfProps) {
  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <Band logoSrc={logoSrc} contourSrc={contourSrc} />
      <Info report={report} unit={unit} />
      <ColumnHeaders />
      <View style={s.table}>
        {unit.rows.map((row, index) => (
          <View key={`${row.sku}-${row.identified_at}-${index}`} style={s.row} wrap={false}>
            <View style={[s.td, W.product]}>
              <Text>{t(row.product_name)}</Text>
              <Text style={s.sku}>SKU {row.sku}</Text>
            </View>
            <View style={[s.td, W.qty]}><Text style={right}>{unitsText(row.quantity)}</Text></View>
            <View style={[s.td, s.tdTint, W.prev]}><Text>{formatInstant(row.previous_conference_at)}</Text></View>
            <View style={[s.td, s.tdTint, W.found]}><Text>{formatInstant(row.identified_at)}</Text></View>
            <View style={[s.td, W.price]}><Text style={right}>{priceText(row)}</Text></View>
            <View style={[s.td, W.loss]}><Text style={right}>{lossText(row)}</Text></View>
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <View style={[s.td, W.product]}><Text>TOTAL DA UNIDADE</Text></View>
          <View style={[s.td, W.qty]}><Text style={right}>{unitsText(unit.total_quantity)}</Text></View>
          <View style={[s.td, { width: 224 + 96 }]}><Text /></View>
          <View style={[s.td, W.loss]}><Text style={right}>{totalText(unit.total_loss_cents, unit.partial)}</Text></View>
        </View>
      </View>
      <Text style={s.note} wrap={false}>{PRICE_NOTE}{unit.partial ? ` ${t(partialNote(unit.unpriced_rows))}` : ""}</Text>
      <Footer issuedOn={issuedOn} />
    </Page>
  );
}

function SummaryPage({ report, units, issuedOn, logoSrc, contourSrc }: { report: ClientDivergenceReport; units: ClientDivergenceUnit[] } & ClientReportPdfProps) {
  const cols = { unit: { flexGrow: 1, flexBasis: 0 }, qty: { width: 150 }, loss: { width: 190 } };
  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <Band logoSrc={logoSrc} contourSrc={contourSrc} />
      <Info report={report} />
      <View style={s.table}>
        <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: C.purple, marginBottom: 6 }}>Resumo por unidade</Text>
        <View fixed style={s.headRow}>
          <View style={[s.th, cols.unit]}><Text>Unidade</Text></View>
          <View style={[s.th, cols.qty]}><Text style={right}>Quantidade em falta</Text></View>
          <View style={[s.th, cols.loss]}><Text style={right}>Valor da perda</Text></View>
        </View>
        {units.map((unit) => (
          <View key={unit.store_id} style={s.row} wrap={false}>
            <View style={[s.td, cols.unit]}><Text>{t(unit.code)}</Text></View>
            <View style={[s.td, cols.qty]}><Text style={right}>{unitsText(unit.total_quantity)}</Text></View>
            <View style={[s.td, cols.loss]}><Text style={right}>{totalText(unit.total_loss_cents, unit.partial)}</Text></View>
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <View style={[s.td, cols.unit]}><Text>TOTAL GERAL</Text></View>
          <View style={[s.td, cols.qty]}><Text style={right}>{unitsText(report.totals.quantity)}</Text></View>
          <View style={[s.td, cols.loss]}><Text style={right}>{totalText(report.totals.loss_cents, report.totals.partial)}</Text></View>
        </View>
      </View>
      <Text style={s.note} wrap={false}>{PRICE_NOTE}{report.totals.partial ? ` ${t(partialNote(report.totals.unpriced_rows))}` : ""}</Text>
      <Footer issuedOn={issuedOn} />
    </Page>
  );
}

/**
 * A4 landscape. A summary page when several units are exported, then one page (or more) per unit, each starting on a new
 * page and repeating the brand band, client, unit and column headers. Built from the same payload the screen shows, so
 * quantities, dates, prices and totals are identical. No cost, margin, camera hint or internal classification is printed.
 */
export function ClientReportPdf(props: ClientReportPdfProps) {
  const { report } = props;
  const units = unitsWithRows(report);

  return (
    <Document title={`${REPORT_TITLE} - ${report.client.name}`} author="Agiliz.ai" subject={periodText(report)}>
      {units.length > 1 ? <SummaryPage {...props} units={units} /> : null}
      {units.map((unit) => (
        <UnitPage key={unit.store_id} {...props} unit={unit} />
      ))}
      {units.length === 0 ? (
        <Page size="A4" orientation="landscape" style={s.page}>
          <Band logoSrc={props.logoSrc} contourSrc={props.contourSrc} />
          <Info report={report} />
          <Text style={s.empty}>Nenhuma divergência encontrada no período.</Text>
          <Footer issuedOn={props.issuedOn} />
        </Page>
      ) : null}
    </Document>
  );
}
