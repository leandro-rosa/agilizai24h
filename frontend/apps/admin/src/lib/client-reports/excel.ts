import type { Workbook } from "exceljs";

import type { ClientDivergenceReport, ClientDivergenceUnit } from "@/lib/api/client-reports";
import { NOT_AVAILABLE, PERIOD_NOTE, PRICE_NOTE, PRICE_NOT_AVAILABLE, REPORT_TITLE, VALUE_NOT_AVAILABLE, partialNote, periodText, unitsWithRows } from "./model";

/**
 * The report states wall-clock times and the API carries them in the UTC fields of the instant, so the cell must hold that SAME
 * instant: Excel stores a Date by its UTC epoch, and a Date built from local fields would shift every time by the viewer's offset
 * (and roll late-evening visits onto the next day). The screen and the PDF read the UTC fields too.
 */
const wallClock = (iso: string): Date => new Date(iso);

const MONEY = '"R$" #,##0.00';
const DATE_TIME = "dd/mm/yyyy hh:mm";
const PURPLE = "FF5B2D8E";
const LILAC = "FFF5EFFA";

/** An Excel sheet name: at most 31 chars, none of \ / ? * [ ] :, unique case-insensitively. */
export function sheetNames(codes: string[]): string[] {
  const used = new Set<string>(["resumo"]);
  return codes.map((code) => {
    const base = (code.replace(/[\\/?*[\]:]/g, "-").trim() || "Unidade").slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 1)}-${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

type Sheet = ReturnType<Workbook["addWorksheet"]>;

function styleHeader(sheet: Sheet, rowNumber: number) {
  const row = sheet.getRow(rowNumber);
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PURPLE } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function unitSheet(workbook: Workbook, name: string, report: ClientDivergenceReport, unit: ClientDivergenceUnit) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Cliente", width: 20 },
    { header: "Unidade", width: 12 },
    { header: "Código/SKU", width: 14 },
    { header: "Produto", width: 38 },
    { header: "Quantidade em falta", width: 14 },
    { header: "Conferência anterior", width: 20 },
    { header: "Falta identificada em", width: 20 },
    { header: "Preço de venda unitário", width: 18 },
    { header: "Valor da perda", width: 16 },
    { header: "Observação", width: 34 },
  ];
  styleHeader(sheet, 1);

  for (const row of unit.rows) {
    const notes = [row.unit_price_cents === null ? PRICE_NOT_AVAILABLE : null, row.previous_conference_at === null ? "Conferência anterior não disponível" : null].filter(Boolean);
    const added = sheet.addRow([
      report.client.name,
      unit.code,
      row.sku,
      row.product_name,
      row.quantity,
      row.previous_conference_at === null ? NOT_AVAILABLE : wallClock(row.previous_conference_at),
      wallClock(row.identified_at),
      row.unit_price_cents === null ? PRICE_NOT_AVAILABLE : row.unit_price_cents / 100,
      row.loss_cents === null ? VALUE_NOT_AVAILABLE : row.loss_cents / 100,
      notes.join("; "),
    ]);
    added.getCell(6).numFmt = DATE_TIME;
    added.getCell(7).numFmt = DATE_TIME;
    added.getCell(8).numFmt = MONEY;
    added.getCell(9).numFmt = MONEY;
    for (const column of [6, 7]) added.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LILAC } };
    added.getCell(5).alignment = { horizontal: "right" };
    added.getCell(8).alignment = { horizontal: "right" };
    added.getCell(9).alignment = { horizontal: "right" };
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + unit.rows.length, column: 10 } };

  // The totals sit below the filtered block, separated by an empty row, so sorting/filtering never moves them.
  const total = sheet.addRow([]);
  const footer = sheet.addRow(["Total da unidade", unit.code, null, null, unit.total_quantity, null, null, null, unit.total_loss_cents / 100, unit.partial ? partialNote(unit.unpriced_rows) : ""]);
  footer.font = { bold: true };
  footer.getCell(9).numFmt = MONEY;
  total.height = 6;
}

/** The workbook of the report: a "Resumo" sheet and one sheet per unit with occurrences, from the SAME payload the screen shows. */
export async function buildClientReportWorkbook(report: ClientDivergenceReport): Promise<Workbook> {
  const { Workbook: ExcelWorkbook } = await import("exceljs");
  const workbook = new ExcelWorkbook();
  workbook.creator = "Agiliz.ai";
  const units = unitsWithRows(report);
  const names = sheetNames(units.map((unit) => unit.code));

  const summary = workbook.addWorksheet("Resumo", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [
    { header: "Cliente", width: 22 },
    { header: "Período consultado", width: 26 },
    { header: "Unidade", width: 14 },
    { header: "Quantidade em falta", width: 16 },
    { header: "Valor da perda", width: 16 },
    { header: "Ocorrências", width: 13 },
    { header: "Observação", width: 46 },
  ];
  styleHeader(summary, 1);

  units.forEach((unit, index) => {
    const row = summary.addRow([report.client.name, periodText(report), unit.code, unit.total_quantity, unit.total_loss_cents / 100, unit.rows.length, unit.partial ? partialNote(unit.unpriced_rows) : ""]);
    row.getCell(5).numFmt = MONEY;
    row.getCell(3).value = { text: unit.code, hyperlink: `#'${names[index]}'!A1` };
  });
  summary.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + units.length, column: 7 } };

  // Below the filtered block, so filtering and sorting never move the total or the notes.
  summary.addRow([]);
  if (units.length === 0) {
    summary.addRow(["Nenhuma divergência encontrada no período."]);
  } else {
    const total = summary.addRow(["Total geral", periodText(report), null, report.totals.quantity, report.totals.loss_cents / 100, report.totals.rows, report.totals.partial ? partialNote(report.totals.unpriced_rows) : ""]);
    total.font = { bold: true };
    total.getCell(5).numFmt = MONEY;
  }
  summary.addRow([]);
  for (const note of [REPORT_TITLE, PERIOD_NOTE, PRICE_NOTE]) summary.addRow([note]).font = { italic: true, color: { argb: "FF6B6B6B" } };

  units.forEach((unit, index) => unitSheet(workbook, names[index], report, unit));

  return workbook;
}

export async function downloadClientReportWorkbook(report: ClientDivergenceReport, filename: string): Promise<void> {
  const workbook = await buildClientReportWorkbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
