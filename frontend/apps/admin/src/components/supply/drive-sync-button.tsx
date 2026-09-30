"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useImportDriveFileMutation, useLazyGetDriveFilesQuery, useScanDriveMutation, type DriveFile } from "@/lib/api/ingestion";

/** A mensagem do servidor quando ele deu uma, senão a nossa. */
function messageOf(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: unknown } })?.data;
  return typeof data?.message === "string" && data.message !== "" ? data.message : fallback;
}

/**
 * Mesmo critério que já habilita o botão "Importar" manual em /ingestion —
 * validado, sem pendência de substituição nem duplicata, com tipo e período
 * sugeridos. Qualquer coisa fora disso fica para revisão manual, nunca é
 * forçada — a substituição de um mês já importado em particular nunca é
 * automática.
 */
function isAutoImportEligible(file: DriveFile): boolean {
  return (
    (file.status === "new" || file.status === "changed") &&
    !file.is_synthetic &&
    file.validation_status === "passed" &&
    file.would_replace === null &&
    file.duplicate_of === null &&
    file.suggested_file_type !== null &&
    file.suggested_period !== null
  );
}

export function DriveSyncButton() {
  const [scanDrive] = useScanDriveMutation();
  const [importDriveFile] = useImportDriveFileMutation();
  const [fetchFiles] = useLazyGetDriveFilesQuery();
  const [running, setRunning] = useState(false);

  const handleClick = async () => {
    setRunning(true);
    try {
      await scanDrive().unwrap();
      const files = await fetchFiles().unwrap();
      const candidates = files.filter(isAutoImportEligible);
      const pendingFromScan = files.filter((file) => (file.status === "new" || file.status === "changed") && !isAutoImportEligible(file)).length;

      let imported = 0;
      let failed = 0;
      for (const file of candidates) {
        try {
          await importDriveFile({
            id: file.id,
            file_type: file.suggested_file_type!,
            period: file.suggested_period!,
          }).unwrap();
          imported++;
        } catch {
          failed++;
        }
      }

      const needsReview = pendingFromScan + failed;
      const summary =
        imported === 0 && needsReview === 0
          ? "Sincronizado — nenhum arquivo novo."
          : needsReview > 0
            ? `${imported} arquivo(s) importado(s) automaticamente. ${needsReview} precisa(m) de revisão manual em /ingestion.`
            : `${imported} arquivo(s) importado(s) automaticamente.`;
      toast.success(summary);
    } catch (error) {
      toast.error(messageOf(error, "Não foi possível sincronizar com o Drive. Tente novamente."));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={running} onClick={handleClick}>
      <RefreshCw className={running ? "animate-spin" : undefined} />
      Sincronizar com o Drive
    </Button>
  );
}
