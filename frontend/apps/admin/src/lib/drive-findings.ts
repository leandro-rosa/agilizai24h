import type { DriveFile, DriveFinding, DriveImportableFileType } from "@/lib/api/ingestion";
import { date } from "@/lib/format";

/**
 * O backend devolve cada achado com um `code` estável e os números em
 * `details`; o texto para o operador é montado aqui, em português. A
 * `message` em inglês que vem junto é só rede de segurança para um código
 * que esta tela ainda não conhece — nunca some um achado por falta de tradução.
 */

const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const percent = (value: unknown): string => {
  const n = number(value);
  return n === null ? "—" : `${(n * 100).toFixed(1).replace(".", ",")}%`;
};

export const FILE_TYPE_LABELS: Record<DriveImportableFileType, string> = {
  sales: "Vendas",
  supply: "Abastecimento",
};

/** "2026-08" → "ago/2026" — o mesmo formato do resto do painel. */
function monthLabel(period: string | null): string {
  if (!period) return "—";
  const [year, month] = period.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(month) - 1] ?? month}/${year}`;
}

/**
 * A situação de uma ingestão já existente, em português, para o aviso de
 * substituição. Só as duas que um período "substituível" pode ter; qualquer
 * outra cai no texto cru em vez de sumir.
 */
export function describeIngestionStatus(status: string): string {
  if (status === "completed") return "concluída";
  if (status === "partially_completed") return "parcialmente concluída";
  return status;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** O achado em português, com os números que o sustentam. */
export function describeFinding(finding: DriveFinding): string {
  const d = finding.details ?? {};

  switch (finding.code) {
    case "edge_start":
      return `O primeiro registro do arquivo é de ${date(text(d.firstDay))}, mais de ${number(d.toleranceDays) ?? "?"} dias depois do início do mês.`;
    case "edge_end":
      return `O último registro do arquivo é de ${date(text(d.lastDay))}; o período vai até ${date(text(d.endDay))}, e a diferença passa de ${number(d.toleranceDays) ?? "?"} dias. O arquivo pode ter sido cortado.`;
    case "low_file_coverage":
      return `Cobertura do arquivo nos dias esperados de operação: ${percent(d.coverage)} (mínimo ${percent(d.minimum)}).`;
    case "low_store_coverage":
      return `${text(d.store) ?? "Loja"}: registros em ${number(d.coveredDays) ?? "?"} de ${number(d.expectedDays) ?? "?"} dias esperados de operação (${percent(d.coverage)}, mínimo ${percent(d.minimum)}).`;
    case "store_not_verifiable":
      return `${text(d.store) ?? "Loja"}: dias de operação insuficientes para verificar a cobertura.`;
    case "period_mismatch":
      return `Só ${percent(d.share)} das linhas com data caem em ${monthLabel(text(d.period))}; a maioria é de ${monthLabel(text(d.observedMonth))}.`;
    case "no_readable_dates":
      return "O arquivo não tem datas legíveis, então não foi possível verificar o período.";
    case "legacy_format":
      return "Este é o relatório antigo por loja. Envie-o manualmente em “Enviar planilha”, informando a loja.";
    case "unknown_format":
      return "A estrutura do arquivo não foi reconhecida como relatório de vendas da rede nem como relatório de abastecimento.";
    case "format_mismatch":
      return `O arquivo foi informado como ${FILE_TYPE_LABELS[d.expected as DriveImportableFileType] ?? String(d.expected)}, mas a estrutura dele é de ${FILE_TYPE_LABELS[d.found as DriveImportableFileType] ?? String(d.found)}.`;
    case "too_large": {
      const size = number(d.sizeBytes);
      const max = number(d.maxBytes);
      return `O arquivo${size !== null ? ` (${formatBytes(size)})` : ""} passa do limite de ${formatBytes(max)}.`;
    }
    case "duplicate":
      return `Conteúdo idêntico ao de um arquivo já importado para este tipo e período (${text(d.path) ?? "outro arquivo"}${d.importedAt ? `, em ${date(text(d.importedAt))}` : ""}).`;
    case "synthetic":
      return "Arquivo marcado como sintético: ele nunca é importado em dados reais.";
    case "unreadable_file":
      return "Não foi possível abrir o arquivo como planilha.";
    default:
      return finding.message;
  }
}

/** Datas ausentes de uma loja (até 10), já formatadas — só existem no achado de cobertura baixa da loja. */
export function missingDatesOf(finding: DriveFinding): string[] {
  const dates = finding.details?.missingDates;
  return Array.isArray(dates) ? dates.filter((v): v is string => typeof v === "string").map((v) => date(v)) : [];
}

/** Por que o arquivo não pode ser importado agora, ou null se pode. É o texto que aparece ao lado do botão desabilitado. */
export function importBlockReason(file: DriveFile, type: DriveImportableFileType | null, period: string): string | null {
  if (file.is_synthetic) return "Arquivo sintético: nunca é importado em dados reais.";
  if (file.duplicate_of) {
    const { path, imported_at } = file.duplicate_of;
    return `Conteúdo idêntico ao já importado de ${path || "outra pasta"}${imported_at ? `, em ${date(imported_at)}` : ""}.`;
  }
  if (file.validation_status === "blocked") return file.validation?.blocking[0] ? describeFinding(file.validation.blocking[0]) : "Arquivo bloqueado pela validação.";
  if (file.validation_status === "validating") return "Validando o arquivo…";
  if (file.validation_status === "none" || file.validation_status === "failed") return "Valide o arquivo antes de importar.";
  if (!type) return "Escolha o tipo do arquivo.";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return "Informe o período.";
  return null;
}

/** As razões em português para o operador entender o campo vazio ou preenchido pelo conteúdo. */
const SUGGESTION_NOTES: Record<string, string> = {
  generic_name: "Nome genérico: o tipo é confirmado pelo conteúdo do arquivo.",
  ambiguous_name: "O nome cita vendas e abastecimento: escolha o tipo.",
  unknown_name: "O nome não indica o tipo: escolha ou aguarde a validação.",
  conflict: "A pasta e o nome do arquivo indicam meses diferentes: confira o período.",
  no_month: "Não foi possível ler o mês pela pasta: informe o período.",
  no_year: "A pasta tem o mês mas não o ano: informe o período.",
  ambiguous_month: "A pasta cita mais de um mês: informe o período.",
  ambiguous_year: "As pastas e o arquivo indicam anos diferentes: informe o período.",
  period_from_file_name: "Período tirado do nome do arquivo.",
  derived_from_content: "Preenchido a partir do conteúdo do arquivo.",
};

export function describeSuggestionNote(note: string | null): string | null {
  return note ? (SUGGESTION_NOTES[note] ?? null) : null;
}
