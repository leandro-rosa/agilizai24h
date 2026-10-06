import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Purchase } from "@/lib/api/purchases";
import { formatCents, formatDate } from "./money";

/** A fonte padrão (Helvetica) não tem o travessão longo: troca por um equivalente seguro. */
const t = (s: string) => s.replace(/\u2014/g, "-").replace(/\u00a0/g, " ");

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#222" },
  title: { fontSize: 16, marginBottom: 4 },
  muted: { color: "#666", marginBottom: 12 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ccc", paddingVertical: 4 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#222", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  product: { flex: 1 },
  qty: { width: 50, textAlign: "right" },
  cost: { width: 70, textAlign: "right" },
  total: { width: 80, textAlign: "right" },
  sum: { marginTop: 8, textAlign: "right", fontFamily: "Helvetica-Bold" },
  notes: { marginTop: 12 },
});

/**
 * O pedido em PDF, anexado ao e-mail para o fornecedor. É gerado no navegador, com o mesmo renderizador do resumo mensal; o corpo do
 * e-mail já traz o pedido por inteiro, então o PDF é só um complemento para arquivar ou imprimir.
 */
export function OrderPdf({ order, supplierName }: { order: Purchase; supplierName: string }) {
  const total = order.items.reduce((sum, item) => sum + item.quantity * item.unit_cost_cents, 0);
  const terms = [
    order.expected_delivery_on ? `Prazo de entrega: ${formatDate(order.expected_delivery_on)}` : null,
    order.payment_term === "on_receipt" ? "Pagamento: ao receber" : order.payment_term === "due_date" && order.payment_due_on ? `Pagamento: boleto para ${formatDate(order.payment_due_on)}` : null,
  ].filter((line): line is string => line !== null);

  return (
    <Document title={`Pedido de compra ${order.id}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{t(`Pedido de compra nº ${order.id}`)}</Text>
        <Text style={styles.muted}>{t(`Agiliz.AI - ${formatDate(order.ordered_on)} - Fornecedor: ${supplierName}`)}</Text>
        <View style={styles.head}>
          <Text style={styles.product}>Produto</Text>
          <Text style={styles.qty}>Qtd.</Text>
          <Text style={styles.cost}>Custo un.</Text>
          <Text style={styles.total}>Total</Text>
        </View>
        {order.items.map((item) => (
          <View key={item.id} style={styles.row} wrap={false}>
            <Text style={styles.product}>{t(`${item.description ?? item.sku} (${item.sku})`)}</Text>
            <Text style={styles.qty}>{item.quantity}</Text>
            <Text style={styles.cost}>{t(formatCents(item.unit_cost_cents))}</Text>
            <Text style={styles.total}>{t(formatCents(item.quantity * item.unit_cost_cents))}</Text>
          </View>
        ))}
        <Text style={styles.sum}>{t(`Total: ${formatCents(total)}`)}</Text>
        {terms.map((line) => (
          <Text key={line} style={styles.notes}>
            {t(line)}
          </Text>
        ))}
        {order.notes && <Text style={styles.notes}>{t(`Observações: ${order.notes}`)}</Text>}
      </Page>
    </Document>
  );
}

/** O PDF do pedido em base64 (sem o prefixo `data:`), pronto para ir junto do pedido de envio. O renderizador é carregado só aqui. */
export async function orderPdfBase64(order: Purchase, supplierName: string): Promise<string> {
  const { pdf } = await import("@react-pdf/renderer");
  const blob = await pdf(<OrderPdf order={order} supplierName={supplierName} />).toBlob();
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));

  return btoa(binary);
}
