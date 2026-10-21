import type { ClientDivergenceReport, ClientDivergenceRow, ClientDivergenceUnit } from "@/lib/api/client-reports";

/** FICTITIOUS data for tests and the PDF preview only — a made-up client, units and products. Never a real record. */
export const FICTITIOUS_CLIENT = "Cliente Fictício";

export function row(over: Partial<ClientDivergenceRow> & Pick<ClientDivergenceRow, "sku" | "product_name" | "quantity" | "identified_at">): ClientDivergenceRow {
  const unit_price_cents = over.unit_price_cents === undefined ? 600 : over.unit_price_cents;
  return {
    previous_conference_at: "2026-05-04T09:00:00.000Z",
    unit_price_cents,
    loss_cents: unit_price_cents === null ? null : over.quantity * unit_price_cents,
    source: { identified: { visit_id: 2, sheet: "Operação 2", kind: "inventory" }, previous: { visit_id: 1, sheet: "Operação 1", kind: "combined" } },
    ...over,
  };
}

export function unit(storeId: number, code: string, rows: ClientDivergenceRow[]): ClientDivergenceUnit {
  const unpriced = rows.filter((r) => r.loss_cents === null).length;
  return {
    store_id: storeId,
    code,
    rows,
    total_quantity: rows.reduce((sum, r) => sum + r.quantity, 0),
    total_loss_cents: rows.reduce((sum, r) => sum + (r.loss_cents ?? 0), 0),
    unpriced_rows: unpriced,
    partial: unpriced > 0,
  };
}

export function report(units: ClientDivergenceUnit[], over: Partial<ClientDivergenceReport> = {}): ClientDivergenceReport {
  const all = units.flatMap((u) => u.rows);
  const unpriced = units.reduce((sum, u) => sum + u.unpriced_rows, 0);
  return {
    client: { id: 9, name: FICTITIOUS_CLIENT },
    from: "2026-05-01",
    to: "2026-05-11",
    units,
    totals: {
      quantity: units.reduce((sum, u) => sum + u.total_quantity, 0),
      loss_cents: units.reduce((sum, u) => sum + u.total_loss_cents, 0),
      distinct_products: new Set(all.map((r) => r.sku)).size,
      rows: all.length,
      unpriced_rows: unpriced,
      partial: unpriced > 0,
    },
    unsplit_visits: 0,
    ...over,
  };
}

/** The example of the brief: one unit, four products, R$ 100,00. */
export const SINGLE_UNIT = report([
  unit(1, "SP01", [
    row({ sku: "100112", product_name: "Coca-Cola lata 350 ml", quantity: 5, identified_at: "2026-05-07T10:12:00.000Z", previous_conference_at: "2026-05-04T09:00:00.000Z", unit_price_cents: 600 }),
    row({ sku: "100113", product_name: "Monster Energy 473 ml", quantity: 3, identified_at: "2026-05-07T10:12:00.000Z", previous_conference_at: "2026-05-02T14:30:00.000Z", unit_price_cents: 1200 }),
    row({ sku: "100114", product_name: "Chocolate KitKat 41,5 g", quantity: 4, identified_at: "2026-05-11T16:40:00.000Z", previous_conference_at: "2026-05-07T10:12:00.000Z", unit_price_cents: 500 }),
    row({ sku: "100115", product_name: "Água de coco 1 L", quantity: 1, identified_at: "2026-05-11T16:40:00.000Z", previous_conference_at: "2026-05-05T08:05:00.000Z", unit_price_cents: 1400 }),
  ]),
]);

/** Many units and many rows, one unit without a price and without a previous conference — for pagination and partial totals. */
export function manyUnits(rowsPerUnit = 40): ClientDivergenceReport {
  const make = (storeId: number, code: string, count: number, priced: boolean) =>
    unit(
      storeId,
      code,
      Array.from({ length: count }, (_, i) =>
        row({
          sku: String(100000 + i),
          product_name: `Produto fictício número ${i + 1} com um nome razoavelmente longo`,
          quantity: (i % 5) + 1,
          identified_at: `2026-05-${String(1 + (i % 11)).padStart(2, "0")}T1${i % 10}:15:00.000Z`,
          previous_conference_at: i % 7 === 0 ? null : `2026-04-${String(10 + (i % 15)).padStart(2, "0")}T09:00:00.000Z`,
          unit_price_cents: priced || i % 4 !== 0 ? 350 + i * 10 : null,
        }),
      ).sort((a, b) => a.identified_at.localeCompare(b.identified_at) || a.sku.localeCompare(b.sku)),
    );
  return report([make(1, "SP01", rowsPerUnit, true), make(2, "SP02", 3, true), make(3, "SP03", rowsPerUnit - 10, false)]);
}
