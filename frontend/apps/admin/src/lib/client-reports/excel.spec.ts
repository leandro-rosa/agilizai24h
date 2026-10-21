import { describe, expect, it } from "@jest/globals";

import { buildClientReportWorkbook, sheetNames } from "./excel";
import { SINGLE_UNIT, manyUnits, report, row, unit } from "./fixtures";

async function roundTrip(input: ReturnType<typeof report>) {
  const { Workbook } = await import("exceljs");
  const written = await (await buildClientReportWorkbook(input)).xlsx.writeBuffer();
  const reread = new Workbook();
  await reread.xlsx.load(written as never);
  return reread;
}

describe("client divergence workbook (fictitious data)", () => {
  it("has a Resumo and one sheet per unit, with frozen first row and filters", async () => {
    const workbook = await roundTrip(manyUnits());

    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Resumo", "SP01", "SP02", "SP03"]);
    for (const sheet of workbook.worksheets) {
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
    }
  });

  it("writes dates and money as real cell types, and the same values as the payload", async () => {
    const workbook = await roundTrip(SINGLE_UNIT);
    const sheet = workbook.getWorksheet("SP01")!;
    const first = sheet.getRow(2);

    expect(first.getCell(3).value).toBe("100112");
    expect(first.getCell(5).value).toBe(5);
    expect(first.getCell(6).value).toBeInstanceOf(Date);
    expect(first.getCell(7).value).toBeInstanceOf(Date);
    expect((first.getCell(7).value as Date).getUTCHours()).toBe(10);
    expect((first.getCell(7).value as Date).getUTCMinutes()).toBe(12);
    expect(first.getCell(8).value).toBe(6);
    expect(first.getCell(9).value).toBe(30);
    expect(first.getCell(9).numFmt).toContain("R$");
    expect(sheet.getRow(7).getCell(9).value).toBe(100); // total da unidade (after the blank separator row)
    expect(workbook.getWorksheet("Resumo")!.getRow(2).getCell(5).value).toBe(100);
  });

  it("keeps the report wall-clock time whatever the viewer time zone: same instant, no day rollover for a late-evening visit", async () => {
    const late = report([unit(1, "SP01", [row({ sku: "L", product_name: "Produto L", quantity: 1, identified_at: "2026-05-07T22:30:00.000Z", previous_conference_at: "2026-05-07T00:05:00.000Z" })])]);
    const workbook = await roundTrip(late);
    const cells = workbook.getWorksheet("SP01")!.getRow(2);

    expect((cells.getCell(7).value as Date).toISOString()).toBe("2026-05-07T22:30:00.000Z");
    expect((cells.getCell(6).value as Date).toISOString()).toBe("2026-05-07T00:05:00.000Z");

    // The serial stored in the file: 07/05/2026 22:30 is 46149.9375 in the report's own wall-clock, in any TZ.
    const XLSX = await import("xlsx");
    const raw = XLSX.read(await (await buildClientReportWorkbook(late)).xlsx.writeBuffer(), { type: "array", cellDates: false });
    expect(raw.Sheets["SP01"]["G2"].v).toBeCloseTo(46149.9375, 6);
  });

  it("marks a missing price and a missing previous conference, and the partial total", async () => {
    const withGaps = report([
      unit(1, "SP01", [
        { ...SINGLE_UNIT.units[0].rows[0], unit_price_cents: null, loss_cents: null },
        { ...SINGLE_UNIT.units[0].rows[1], previous_conference_at: null },
      ]),
    ]);
    const workbook = await roundTrip(withGaps);
    const sheet = workbook.getWorksheet("SP01")!;

    expect(sheet.getRow(2).getCell(8).value).toBe("Preço não disponível");
    expect(sheet.getRow(2).getCell(9).value).toBe("Indisponível");
    expect(sheet.getRow(3).getCell(6).value).toBe("Não disponível");
    expect(sheet.getRow(5).getCell(10).value).toContain("parcial");
    expect(workbook.getWorksheet("Resumo")!.getRow(2).getCell(7).value).toContain("parcial");
  });

  it("never mentions cameras, cost or margin", async () => {
    const workbook = await roundTrip(manyUnits(5));
    const text: string[] = [];
    workbook.eachSheet((sheet) => sheet.eachRow((r) => r.eachCell((c) => text.push(String(c.value)))));

    expect(text.join(" ").toLowerCase()).not.toMatch(/c[âa]mera|custo|margem|roubo/);
  });

  it("includes every row, not a page of them", async () => {
    const workbook = await roundTrip(manyUnits(120));

    const skus: unknown[] = [];
    workbook.getWorksheet("SP01")!.eachRow((r, n) => n > 1 && r.getCell(3).value && skus.push(r.getCell(3).value));

    expect(skus).toHaveLength(120);
  });

  it("produces valid, unique sheet names", () => {
    const names = sheetNames(["SP01", "sp01", "A/B:C?", "Resumo", "X".repeat(40)]);

    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31 && !/[\\/?*[\]:]/.test(n))).toBe(true);
    expect(names).not.toContain("Resumo");
  });
});
