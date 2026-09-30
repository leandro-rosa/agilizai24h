"use client";

import { memo } from "react";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { TREASURY_SOURCE_LABELS, type TreasuryDriveFile, type TreasuryDriveFileStatus } from "@/lib/api/treasury";

const STATUS: Record<TreasuryDriveFileStatus, { label: string; tone: StatusTone }> = {
  new: { label: "Novo", tone: "attention" },
  changed: { label: "Alterado", tone: "attention" },
  importing: { label: "Importando…", tone: "neutral" },
  imported: { label: "Importado", tone: "positive" },
  ignored: { label: "Ignorado", tone: "neutral" },
  error: { label: "Erro", tone: "critical" },
};

/** Estados em que o arquivo ainda espera uma decisão de quem opera. */
const WAITING: readonly TreasuryDriveFileStatus[] = ["new", "changed", "error"];

export interface DriveFileRowProps {
  file: TreasuryDriveFile;
  canWrite: boolean;
  onImport: (file: TreasuryDriveFile) => void;
  onIgnore: (file: TreasuryDriveFile, ignored: boolean) => void;
}

/**
 * Uma linha por arquivo de extrato achado no Drive. Ao contrário do sibling de
 * vendas/abastecimento (`components/ingestion/drive-file-row.tsx`), não há
 * validação de cobertura aqui — um extrato bancário do mês inteiro não tem
 * "dias esperados de operação" para conferir, então esta linha só mostra
 * banco, tipo detectado e status; "Importar" nunca faz nada sozinho, sempre
 * abre `DriveImportDialog` para o operador confirmar conta e período.
 */
export const DriveFileRow = memo(function DriveFileRow({ file, canWrite, onImport, onIgnore }: DriveFileRowProps) {
  const waiting = WAITING.includes(file.status);
  const status = STATUS[file.status];
  const recognized = file.detected_source !== null;

  return (
    <TableRow>
      <TableCell className="max-w-64">
        <p className="truncate font-medium" title={file.name}>
          {file.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{file.month_folder_name}</p>
      </TableCell>

      <TableCell className="text-sm">{file.bank_folder_name}</TableCell>

      <TableCell className="text-sm">{recognized ? TREASURY_SOURCE_LABELS[file.detected_source!] : "não reconhecido"}</TableCell>

      <TableCell>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {file.status === "error" && file.error_detail && <p className="mt-0.5 text-xs whitespace-normal text-destructive">{file.error_detail}</p>}
      </TableCell>

      <TableCell className="w-40 text-right">
        {canWrite && (
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap justify-end gap-2">
              {waiting && (
                <>
                  <Button size="sm" disabled={!recognized} onClick={() => onImport(file)}>
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
            {waiting && !recognized && <p className="text-right text-xs whitespace-normal text-muted-foreground">Tipo não reconhecido — não é possível importar.</p>}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
});
