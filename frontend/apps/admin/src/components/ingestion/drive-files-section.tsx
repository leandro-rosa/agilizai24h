"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useGetDriveFilesQuery,
  useGetDriveStatusQuery,
  useIgnoreDriveFileMutation,
  useImportDriveFileMutation,
  useScanDriveMutation,
  useValidateDriveFileMutation,
  type DriveFile,
  type DriveImportableFileType,
  type DriveRefusal,
  type DriveStatus,
} from "@/lib/api/ingestion";
import { useHasPermission } from "@/lib/auth/use-permission";
import { DriveFileRow } from "./drive-file-row";
import { DriveImportDialog, type DriveImportConfirmation } from "./drive-import-dialog";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Depois de pedir algo à fila, olha o servidor por este tempo mesmo que ainda não haja nada em andamento para ver. */
const POLL_AFTER_ACTION_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;
/**
 * Teto do polling contínuo. Um arquivo pode ficar "em andamento" para sempre do
 * ponto de vista do painel (um job perdido na fila, um worker parado); sem teto,
 * cada aba aberta consultaria o servidor a cada 3s indefinidamente. Recarregar a
 * página, sincronizar ou agir sobre um arquivo começa um novo período.
 */
const POLL_GIVE_UP_MS = 15 * 60_000;

/** A mensagem do servidor quando ele deu uma, senão a nossa. */
function messageOf(error: unknown, fallback: string): string {
  const data = (error as { data?: Partial<DriveRefusal> })?.data;
  return typeof data?.message === "string" && data.message !== "" ? data.message : fallback;
}

function scanSummary(status: DriveStatus): string {
  const scan = status.last_scan;
  if (!scan) return "Nenhuma sincronização ainda. A busca automática roda uma vez por dia; “Sincronizar agora” faz uma na hora.";
  if (scan.outcome === "running") return "Sincronizando com o Drive…";

  const when = dateTimeFormatter.format(new Date(scan.started_at));
  if (scan.outcome === "failed") return `Última sincronização (${when}) falhou: ${scan.error ?? "erro desconhecido"}. Nada foi alterado.`;

  const skipped = scan.skipped_by_pattern > 0 ? `, ${scan.skipped_by_pattern} ignorados pelo nome` : "";
  return `Última sincronização: ${when} — ${scan.files_seen - scan.skipped_by_pattern} arquivos, ${scan.new_count} novos, ${scan.changed_count} alterados${skipped}.`;
}

function NotConfigured() {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">Drive não configurado</p>
      <p className="text-sm text-muted-foreground">
        A leitura automática dos relatórios do Google Drive só liga quando a pasta e a credencial forem definidas no serviço de ingestão. Enquanto isso, o envio
        manual acima continua funcionando.
      </p>
    </div>
  );
}

/**
 * Os relatórios que caem no Drive todo mês: o sistema acha e confere sozinho, e
 * quem opera confirma o “Importar”. Nada é importado por uma busca nem por uma
 * validação — só pelo clique aqui.
 */
export function DriveFilesSection() {
  const canRead = useHasPermission("ingestion:read");
  const canUpload = useHasPermission("ingestion:upload");

  const status = useGetDriveStatusQuery(undefined, { skip: !canRead });
  const configured = status.data?.configured === true;
  const files = useGetDriveFilesQuery(undefined, { skip: !canRead || !configured });

  const [scanDrive, { isLoading: scanning }] = useScanDriveMutation();
  const [validateFile] = useValidateDriveFileMutation();
  const [importFile, { isLoading: importing }] = useImportDriveFileMutation();
  const [ignoreFile] = useIgnoreDriveFileMutation();

  const [pollUntil, setPollUntil] = useState<number | null>(null);
  const [dialogTarget, setDialogTarget] = useState<{ file: DriveFile; fileType: DriveImportableFileType; period: string } | null>(null);

  // Tudo que justifica olhar o servidor de novo, derivado só do que ele já respondeu.
  const scanRunning = status.data?.last_scan?.outcome === "running";
  const autoValidate = status.data?.auto_validate === true;
  const inProgress = (files.data ?? []).some(
    (file) =>
      file.status === "importing" ||
      file.validation_status === "validating" ||
      (autoValidate && ["new", "changed"].includes(file.status) && file.validation_status === "none"),
  );
  const shouldPoll = canRead && configured && (scanRunning || inProgress || pollUntil !== null);

  const refetchStatus = status.refetch;
  const refetchFiles = files.refetch;

  // O polling para quando `shouldPoll` vira false: o efeito roda de novo, limpa o
  // intervalo anterior e não cria outro. O `refetch` e o relógio ficam dentro do
  // callback do timer, nunca no corpo do efeito — é o formato que o lint do
  // app (regras de pureza do React Compiler) aceita. `pollUntil` está nas
  // dependências para que uma nova ação, depois de o teto ter parado o
  // intervalo, comece um período novo.
  useEffect(() => {
    if (!shouldPoll) return;
    let startedAt: number | null = null;
    const id = setInterval(() => {
      const now = Date.now();
      startedAt ??= now;
      if (now - startedAt > POLL_GIVE_UP_MS) {
        clearInterval(id);
        return;
      }
      void refetchStatus();
      void refetchFiles();
      setPollUntil((until) => (until !== null && now > until ? null : until));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [shouldPoll, pollUntil, refetchStatus, refetchFiles]);

  const keepWatching = useCallback(() => setPollUntil(Date.now() + POLL_AFTER_ACTION_MS), []);

  async function handleSync() {
    try {
      const result = await scanDrive().unwrap();
      keepWatching();
      toast.success(result.status === "already_running" ? "Já há uma sincronização em andamento." : "Sincronização iniciada. Os arquivos aparecem abaixo em instantes.");
    } catch (error) {
      toast.error(messageOf(error, "Não foi possível iniciar a sincronização. Tente novamente."));
    }
  }

  const handleValidateChange = useCallback(
    (file: DriveFile, fileType: DriveImportableFileType, period: string) => {
      validateFile({ id: file.id, file_type: fileType, period })
        .unwrap()
        .then((result) => {
          if (result.status === "queued") keepWatching();
        })
        .catch((error) => toast.error(messageOf(error, "Não foi possível reavaliar o arquivo.")));
    },
    [validateFile, keepWatching],
  );

  const handleValidate = useCallback(
    (file: DriveFile) => {
      validateFile({ id: file.id })
        .unwrap()
        .then(() => {
          keepWatching();
          toast.success("Validação iniciada.");
        })
        .catch((error) => toast.error(messageOf(error, "Não foi possível validar o arquivo.")));
    },
    [validateFile, keepWatching],
  );

  const runImport = useCallback(
    async (file: DriveFile, fileType: DriveImportableFileType, period: string, confirmation: DriveImportConfirmation = {}) => {
      try {
        await importFile({ id: file.id, file_type: fileType, period, ...confirmation }).unwrap();
        keepWatching();
        setDialogTarget(null);
        toast.success("Importação iniciada. Acompanhe o processamento no histórico abaixo.");
      } catch (error) {
        // O servidor refaz todas as conferências; se algo mudou desde que a pessoa viu, ele recusa e diz por quê.
        toast.error(messageOf(error, "Não foi possível importar o arquivo."));
      }
    },
    [importFile, keepWatching],
  );

  const handleImport = useCallback(
    (file: DriveFile, fileType: DriveImportableFileType, period: string) => {
      // Inconsistência a revisar ou período já ingerido: a pessoa vê o que está confirmando antes.
      if (file.validation_status === "needs_validation" || file.would_replace) {
        setDialogTarget({ file, fileType, period });
        return;
      }
      void runImport(file, fileType, period);
    },
    [runImport],
  );

  const handleIgnore = useCallback(
    (file: DriveFile, ignored: boolean) => {
      ignoreFile({ id: file.id, ignored })
        .unwrap()
        .catch((error) => toast.error(messageOf(error, ignored ? "Não foi possível ignorar o arquivo." : "Não foi possível restaurar o arquivo.")));
    },
    [ignoreFile],
  );

  const rows = useMemo(() => files.data ?? [], [files.data]);
  const syncBusy = scanning || scanRunning;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="drive-files-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="drive-files-title" className="text-sm font-medium">
            Arquivos no Drive
          </h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {status.data?.configured
              ? scanSummary(status.data)
              : "Relatórios de vendas e de abastecimento que caem no Google Drive todo mês."}
          </p>
        </div>
        {canUpload && configured && (
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncBusy}>
            <RefreshCw className={syncBusy ? "animate-spin" : undefined} aria-hidden />
            {syncBusy ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        )}
      </div>

      <RequestState isLoading={status.isLoading} error={status.error} onRetry={refetchStatus}>
        {!configured ? (
          <NotConfigured />
        ) : (
          // `contain-inline-size`: o container de rolagem da própria tabela não conta
          // para a largura mínima do conteúdo da página. Sem isso, em janela estreita
          // a tabela estica a página inteira em vez de rolar dentro do cartão.
          <div className="contain-inline-size rounded-lg border">
            <RequestState
              isLoading={files.isLoading}
              error={files.error}
              isEmpty={!files.isLoading && !files.error && rows.length === 0}
              emptyMessage="Nenhum arquivo do Drive encontrado ainda. Use “Sincronizar agora” para procurar."
              onRetry={refetchFiles}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Validação</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((file) => (
                    <DriveFileRow
                      key={file.id}
                      file={file}
                      canUpload={canUpload}
                      onValidateChange={handleValidateChange}
                      onValidate={handleValidate}
                      onImport={handleImport}
                      onIgnore={handleIgnore}
                    />
                  ))}
                </TableBody>
              </Table>
            </RequestState>
          </div>
        )}
      </RequestState>

      <DriveImportDialog
        target={dialogTarget}
        pending={importing}
        onOpenChange={(open) => !open && setDialogTarget(null)}
        onConfirm={(confirmation) => dialogTarget && runImport(dialogTarget.file, dialogTarget.fileType, dialogTarget.period, confirmation)}
      />
    </section>
  );
}

