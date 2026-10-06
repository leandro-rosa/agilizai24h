import { buildOverdueDetail, overdueSummary, OVERDUE } from "./overdue";

const inv = (clientName: string, amountCents: number, dueOn: string) => ({ clientName, amountCents, dueOn });

describe("buildOverdueDetail", () => {
  it("separa por cliente, conta dias de atraso e divide em atraso curto e longo", () => {
    const d = buildOverdueDetail(
      [inv("Ascenty", 100_000, "2026-10-04"), inv("Ascenty", 50_000, "2026-10-04"), inv("Rolls-Royce", 70_000, "2026-10-04"), inv("Ascenty", 20_000, "2026-09-01")],
      "2026-10-06",
    )!;
    expect(d.count).toBe(4);
    expect(d.totalCents).toBe(240_000);
    expect(d.maxDaysOverdue).toBe(35);
    expect(d.byClient.map((c) => [c.name, c.count, c.cents])).toEqual([["Ascenty", 3, 170_000], ["Rolls-Royce", 1, 70_000]]);
    expect(d.short).toEqual({ count: 3, cents: 220_000 });
    expect(d.long).toEqual({ count: 1, cents: 20_000 });
  });

  it("nota que vence hoje ou no futuro não é vencida", () => {
    expect(buildOverdueDetail([inv("A", 1000, "2026-10-06"), inv("A", 1000, "2026-10-20")], "2026-10-06")).toBeNull();
  });

  it("o corte do atraso curto é inclusivo", () => {
    const edge = buildOverdueDetail([inv("A", 1000, "2026-10-01")], "2026-10-06")!; // 5 dias
    expect(OVERDUE.SHORT_DAYS).toBe(5);
    expect(edge.short.count).toBe(1);
    expect(buildOverdueDetail([inv("A", 1000, "2026-09-30")], "2026-10-06")!.long.count).toBe(1); // 6 dias
  });

  it("resume em uma linha com clientes e dias", () => {
    const d = buildOverdueDetail([inv("Ascenty", 100_000, "2026-10-04"), inv("Rolls-Royce", 70_000, "2026-10-04")], "2026-10-06")!;
    expect(overdueSummary(d, (c) => `R$ ${c / 100}`)).toBe("R$ 1700 · 2 notas · Ascenty (1), Rolls-Royce (1) · até 2 dias de atraso");
  });
});
