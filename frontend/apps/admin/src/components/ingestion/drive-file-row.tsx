"use client";

import { Fragment, memo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  describeFinding,
  describeSuggestionNote,
  FILE_TYPE_LABELS,
  formatBytes,
  importBlockReason,
  missingDatesOf,
} from "@/lib/drive-findings";
import { DRIVE_IMPORTABLE_FILE_TYPES, type DriveFile, type DriveFileStatus, type DriveImportableFileType } from "@/lib/api/ingestion";
import { date, period as periodLabel } from "@/lib/format";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const STATUS: Record<DriveFileStatus, { label: string; tone: StatusTone }> = {
  new: { label: "Novo", tone: "attention" },
  changed: { label: "Alterado", tone: "attention" },
  importing: { label: "Importando…", tone: "neutral" },
  imported: { label: "Importado", tone: "positive" },
  ignored: { label: "Ignorado", tone: "neutral" },
  missing: { label: "Sumiu do Drive", tone: "neutral" },
  error: { label: "Erro", tone: "critical" },
};

/** Estados em que o arquivo ainda espera uma decisão de quem opera. */
const WAITING: readonly DriveFileStatus[] = ["new", "changed", "error"];

function ValidationBadge({ file }: { file: DriveFile }) {
  const inconsistencies = file.validation?.inconsistencies.length ?? 0;

  switch (file.validation_status) {
    case "passed":
      return <StatusBadge tone="positive">Validado</StatusBadge>;
    case "needs_validation":
      return <StatusBadge tone="attention">Requer validação ({inconsistencies})</StatusBadge>;
    case "blocked":
      return <StatusBadge tone="critical">{file.is_synthetic ? "Sintético" : file.duplicate_of ? "Duplicado" : "Bloqueado"}</StatusBadge>;
    case "validating":
      return <StatusBadge>Validando…</StatusBadge>;
    case "failed":
      return <StatusBadge tone="critical">Falha ao validar</StatusBadge>;
    default:
      return <StatusBadge>Não validado</StatusBadge>;
  }
}

function Details({ file }: { file: DriveFile }) {
  const findings = [...(file.validation?.blocking ?? []), ...(file.validation?.inconsistencies ?? [])];
  const stores = [...(file.validation?.stores ?? [])].sort((a, b) => (a.coverage ?? -1) - (b.coverage ?? -1));

  return (
    <div className="flex flex-col gap-4 text-sm">
      {file.error && <p className="text-destructive">{file.error}</p>}

      {findings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {findings.map((finding, index) => {
            const dates = missingDatesOf(finding);
            return (
              <li key={`${finding.code}-${index}`}>
                {describeFinding(finding)}
                {dates.length > 0 && <span className="block text-xs text-muted-foreground">Sem registro em: {dates.join(", ")}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {stores.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Cobertura por loja nos dias esperados de operação</p>
          <div className="max-h-56 overflow-y-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-normal">Loja</th>
                  <th className="tabular px-3 py-1.5 text-right font-normal">Dias esperados</th>
                  <th className="tabular px-3 py-1.5 text-right font-normal">Com registro</th>
                  <th className="tabular px-3 py-1.5 text-right font-normal">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.name} className="border-t">
                    <td className="px-3 py-1.5">{store.name}</td>
                    <td className="tabular px-3 py-1.5 text-right">{store.verifiable ? store.expectedDays : "—"}</td>
                    <td className="tabular px-3 py-1.5 text-right">{store.verifiable ? store.coveredDays : "—"}</td>
                    <td className="tabular px-3 py-1.5 text-right">
                      {store.coverage === null ? "não verificável" : `${(store.coverage * 100).toFixed(1).replace(".", ",")}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline">Tamanho: </dt>
          <dd className="inline">{formatBytes(file.size_bytes)}</dd>
        </div>
        <div>
          <dt className="inline">Visto pela última vez: </dt>
          <dd className="inline">{dateTimeFormatter.format(new Date(file.last_seen_at))}</dd>
        </div>
        {file.confirmed_by && file.confirmed_at && (
          <div>
            <dt className="inline">Importação confirmada por: </dt>
            <dd className="inline">
              {file.confirmed_by}, em {dateTimeFormatter.format(new Date(file.confirmed_at))}
            </dd>
          </div>
        )}
        {file.validation_confirmed_by && file.validation_confirmed_at && (
          <div>
            <dt className="inline">Inconsistências revisadas por: </dt>
            <dd className="inline">
              {file.validation_confirmed_by}, em {dateTimeFormatter.format(new Date(file.validation_confirmed_at))}
            </dd>
          </div>
        )}
      </dl>

      {findings.length === 0 && stores.length === 0 && !file.error && <p className="text-muted-foreground">Nada a revisar neste arquivo.</p>}
    </div>
  );
}

export interface DriveFileRowProps {
  file: DriveFile;
  canUpload: boolean;
  onValidateChange: (file: DriveFile, fileType: DriveImportableFileType, period: string) => void;
  onValidate: (file: DriveFile) => void;
  onImport: (file: DriveFile, fileType: DriveImportableFileType, period: string) => void;
  onIgnore: (file: DriveFile, ignored: boolean) => void;
}

/**
 * Uma linha por arquivo. Tipo e período nascem preenchidos com a sugestão (que
 * vem do nome da pasta e, depois da validação, do conteúdo), mas são da pessoa:
 * o que ela escolher vale mais que a sugestão. Trocar um dos dois reavalia o
 * arquivo na hora, sem baixar nada de novo.
 */
export const DriveFileRow = memo(function DriveFileRow({ file, canUpload, onValidateChange, onValidate, onImport, onIgnore }: DriveFileRowProps) {
  const [expanded, setExpanded] = useState(false);
  // Só o que a pessoa escolheu; enquanto for null, vale o que o sistema sugere e isso acompanha a validação.
  const [chosenType, setChosenType] = useState<DriveImportableFileType | null>(null);
  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null);

  const type = chosenType ?? file.validation?.fileType ?? file.suggested_file_type;
  const period = chosenPeriod ?? file.validation?.period ?? file.suggested_period ?? "";

  const waiting = WAITING.includes(file.status);
  const editable = canUpload && waiting;
  const status = STATUS[file.status];
  const note = describeSuggestionNote(file.suggestion_note);
  const blockReason = importBlockReason(file, type, period);
  const periodIsValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);

  function changeType(next: DriveImportableFileType) {
    setChosenType(next);
    if (periodIsValid) onValidateChange(file, next, period);
  }

  function changePeriod(next: string) {
    setChosenPeriod(next);
    if (type && /^\d{4}-(0[1-9]|1[0-2])$/.test(next)) onValidateChange(file, type, next);
  }

  return (
    <Fragment>
      <TableRow data-state={expanded ? "selected" : undefined}>
        <TableCell className="max-w-64">
          <div className="flex items-start gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="-ml-1.5 mt-0.5 size-6 shrink-0"
              aria-label={expanded ? "Ocultar detalhes" : "Ver detalhes"}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
            <div className="min-w-0">
              <p className="truncate font-medium" title={file.name}>
                {file.name}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={file.path}>
                {file.path || "raiz"}
              </p>
              {note && editable && <p className="mt-0.5 text-xs whitespace-normal text-muted-foreground">{note}</p>}
              {file.would_replace && waiting && (
                <p className="mt-0.5 flex items-center gap-1 text-xs whitespace-normal text-warning">
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                  Vai substituir {periodLabel(period || null)} (ingerido em {date(file.would_replace.ingested_at)})
                </p>
              )}
            </div>
          </div>
        </TableCell>

        <TableCell className="w-40">
          {editable ? (
            <Select value={type ?? ""} onValueChange={(value) => changeType(value as DriveImportableFileType)}>
              <SelectTrigger size="sm" aria-label={`Tipo de ${file.name}`}>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                {DRIVE_IMPORTABLE_FILE_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {FILE_TYPE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm">{type ? FILE_TYPE_LABELS[type] : "—"}</span>
          )}
        </TableCell>

        <TableCell className="w-40">
          {editable ? (
            <Input type="month" className="h-8" aria-label={`Período de ${file.name}`} value={period} onChange={(event) => changePeriod(event.target.value)} />
          ) : (
            <span className="text-sm">{periodLabel(period || null)}</span>
          )}
        </TableCell>

        <TableCell>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </TableCell>

        <TableCell>
          <ValidationBadge file={file} />
        </TableCell>

        <TableCell className="w-40">
          {canUpload && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap justify-end gap-2">
                {waiting && (
                  <>
                    {(file.validation_status === "none" || file.validation_status === "failed") && (
                      <Button variant="outline" size="sm" onClick={() => onValidate(file)}>
                        Validar
                      </Button>
                    )}
                    <Button size="sm" disabled={blockReason !== null || !type} onClick={() => type && onImport(file, type, period)}>
                      Importar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onIgnore(file, true)}>
                      Ignorar
                    </Button>
                  </>
                )}
                {file.status === "ignored" && (
                  <Button variant="outline" size="sm" onClick={() => onIgnore(file, false)}>
                    Restaurar
                  </Button>
                )}
              </div>
              {waiting && blockReason && <p className="text-right text-xs whitespace-normal text-muted-foreground">{blockReason}</p>}
            </div>
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="bg-muted/30 whitespace-normal">
            <Details file={file} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
});
