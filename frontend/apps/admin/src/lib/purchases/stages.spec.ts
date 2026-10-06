import { describe, expect, it } from "@jest/globals";

import type { Purchase, Stage } from "@/lib/api/purchases";
import { groupByStage, nextStage, NEXT_ACTION, orderAlerts, orderTotalCents, STAGES } from "./stages";

const order = (id: number, status: Stage, over: Partial<Purchase> = {}): Purchase => ({ id, status, ordered_on: "2026-10-05", late: false, overdue: false, items: [], ...over }) as unknown as Purchase;

describe("etapas do pedido", () => {
  it("segue as cinco etapas em ordem e termina em recebido", () => {
    expect(STAGES).toEqual(["requisition", "awaiting_invoice", "invoiced", "awaiting_receipt", "received"]);
    expect(nextStage("requisition")).toBe("awaiting_invoice");
    expect(nextStage("awaiting_receipt")).toBe("received");
    expect(nextStage("received")).toBeNull();
  });

  it("cada etapa tem a sua ação, e recebido não tem nenhuma", () => {
    expect(NEXT_ACTION.requisition).toBe("Enviar ao fornecedor");
    expect(NEXT_ACTION.awaiting_receipt).toBe("Receber");
    expect(NEXT_ACTION.received).toBeNull();
  });

  it("agrupa por coluna, mantém as colunas vazias e ordena do mais recente", () => {
    const columns = groupByStage([order(1, "invoiced", { ordered_on: "2026-10-01" }), order(2, "invoiced", { ordered_on: "2026-10-09" }), order(3, "received")]);

    expect(Object.keys(columns)).toEqual(STAGES);
    expect(columns.invoiced.map((o) => o.id)).toEqual([2, 1]);
    expect(columns.requisition).toEqual([]);
    expect(columns.received).toHaveLength(1);
  });

  it("soma o valor do pedido e junta os avisos", () => {
    expect(orderTotalCents(order(1, "invoiced", { items: [{ total_cents: 1000 }, { total_cents: 250 }] as never }))).toBe(1250);
    expect(orderAlerts(order(1, "invoiced", { late: true, overdue: true }))).toEqual(["Entrega atrasada", "Pagamento vencido"]);
    expect(orderAlerts(order(1, "invoiced"))).toEqual([]);
  });
});
