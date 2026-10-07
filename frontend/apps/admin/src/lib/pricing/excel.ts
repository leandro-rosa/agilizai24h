import * as XLSX from "xlsx";

import type { ExportModel } from "./export-model";
import { CONFIDENCE_LABEL, STATUS_LABEL } from "./labels";

/** Reais como número (a planilha formata), centavos nunca. Ausência é célula vazia, nunca zero. */
const reais = (cents: number | null): number | null => (cents === null ? null : Math.round(cents) / 100);

type Cell = string | number | null;

function sheet(header: string[], rows: Cell[][], formats: Record<number, string>): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = header.map((name) => ({ wch: Math.max(12, name.length + 2) }));
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let row = 1; row <= range.e.r; row++) {
    for (const [column, format] of Object.entries(formats)) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: Number(column) })];
      if (cell && cell.t === "n") cell.z = format;
    }
  }

  return ws;
}

const MONEY = '"R$" #,##0.00';
const PCT = "0.0%";

/** Quatro abas: produtos, custos que mudaram, margem por categoria e as informações do cálculo. */
export function buildWorkbook(model: ExportModel): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    sheet(
      ["Código", "Produto", "Categoria", "Fornecedor", "Custo médio (R$)", "Preço atual (R$)", "Margem de contribuição", "Contribuição por unidade (R$)", "Resultado estimado após rateio (margem; não é lucro líquido)", "Meta", "Preço mínimo (R$)", "Preço-meta (R$)", "Preço recomendado (R$)", "Impacto potencial estimado (R$/mês)", "Situação", "Confiança", "Validado"],
      model.products.map((product): Cell[] => [
        product.sku,
        product.name,
        product.categoryLabel,
        product.supplierName,
        reais(product.structure?.productCostCents ?? null),
        reais(product.currentPriceCents),
        product.currentMargin,
        reais(product.unitContributionCents ?? null),
        product.estimatedResultAfterAllocation?.margin ?? null,
        product.targetMargin,
        reais(product.minimumPriceCents),
        reais(product.targetPriceCents),
        reais(product.recommendedPriceCents),
        reais(product.impactCentsPerMonth),
        STATUS_LABEL[product.status],
        CONFIDENCE_LABEL[product.confidence],
        product.validated === undefined ? null : product.validated ? "Sim" : "Não: despesas sem classificação",
      ]),
      { 4: MONEY, 5: MONEY, 6: PCT, 7: MONEY, 8: PCT, 9: PCT, 10: MONEY, 11: MONEY, 12: MONEY, 13: MONEY },
    ),
    "Produtos",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet(
      ["Código", "Produto", "Custo anterior (R$)", "Custo atual (R$)", "Variação", "Variação da margem (p.p.)"],
      model.costChanges.map((row): Cell[] => [row.product.sku, row.product.name, reais(row.previousCostCents), reais(row.currentCostCents), row.variation, row.marginChange === null ? null : row.marginChange * 100]),
      { 2: MONEY, 3: MONEY, 4: PCT, 5: "0.0" },
    ),
    "Custos que mudaram",
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet(
      ["Categoria", "Margem média", "Meta", "Diferença (p.p.)", "Faturamento (R$)", "Participação nas vendas"],
      model.categories.map((row): Cell[] => [row.category, row.averageMargin, row.targetMargin, row.difference === null ? null : row.difference * 100, reais(row.revenueCents), row.revenueShare]),
      { 1: PCT, 2: PCT, 3: "0.0", 4: MONEY, 5: PCT },
    ),
    "Margem por categoria",
  );

  const info: Cell[][] = [
    ["Período", model.period],
    ["Escopo", model.scopeLabel],
    ["Filtros aplicados", model.filtersLabel],
    ["Versão do motor", model.engineVersion],
    ["Versão das regras de negócio", model.parameterVersion],
    ["Calculado em", model.computedAt],
    ["Produtos analisados", model.summary.analysed],
    ["Margem média", model.summary.averageMargin],
    ["Meta de margem", model.summary.targetMargin],
    ["Impacto potencial estimado (R$/mês)", reais(model.summary.potentialImpactCentsPerMonth)],
    ["", ""],
    ["Observações sobre a qualidade dos dados", ""],
    ...model.notes.map((note): Cell[] => ["", note]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(info);
  ws["!cols"] = [{ wch: 40 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, ws, "Informações");

  return workbook;
}

export function workbookFileName(model: ExportModel): string {
  return `Precificacao-Agiliz-${model.period}.xlsx`;
}

/** Baixa a planilha no navegador. */
export function downloadWorkbook(model: ExportModel): void {
  XLSX.writeFile(buildWorkbook(model), workbookFileName(model));
}
