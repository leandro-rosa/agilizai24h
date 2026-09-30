"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { RequestState } from "@/components/request-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useGetTreasuryDriveFilesQuery,
  useGetTreasuryDriveStatusQuery,
  useIgnoreTreasuryDriveFileMutation,
  useImportTreasuryDriveFileMutation,
  useScanTreasuryDriveMutation,
  type TreasuryDriveFile,
} from "@/lib/api/treasury";
import { useHasPermission } from "@/lib/auth/use-permission";
import { DriveFileRow } from "./drive-file-row";
import { DriveImportDialog, type DriveImportConfirmation } from "./drive-import-dialog";

/** Depois de pedir algo à fila, olha o servidor por este tempo mesmo que ainda não haja nada em andamento para ver. */
const POLL_AFTER_ACTION_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;
/**
 * Teto do polling contínuo — mesmo raciocínio do sibling de vendas/abastecimento
 * (`components/ingestion/drive-files-section.tsx`): um arquivo pode ficar
 * "importando" para sempre do ponto de vista do painel (job perdido na fila,
 * worker parado), e sem teto cada aba aberta consultaria o servidor a cada 3s
 * indefinidamente.
 */
const POLL_GIVE_UP_MS = 15 * 60_000;

/** A mensagem do servidor quando ele deu uma, senão a nossa. */
function messageOf(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: string } })?.data;
  return typeof data?.message === "string" && data.message !== "" ? data.message : fallback;
}

function NotConfigured() {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">Drive não configurado</p>
      <p className="text-sm text-muted-foreground">
        A leitura automática dos extratos do Google Drive só liga quando a pasta e a credencial forem definidas no
        serviço de ingestão. Enquanto isso, a importação manual acima continua funcionando.
      </p>
    </div>
  );
}

/**
 * Os extratos bancários (Itaú, C6) que caem no Drive todo mês: o sistema acha
 * e classifica sozinho, quem opera confirma conta+período e clica "Importar".
 * Diferente do sibling de vendas/abastecimento, não há relatório de validação
 * aqui — um extrato do mês inteiro não tem cobertura por dia/loja para
 * conferir, então esta seção é só achar → nomear a conta certa → importar.
 */
export function DriveFilesSection() {
  const canWrite = useHasPermission("treasury:write");

  const status = useGetTreasuryDriveStatusQuery();
  const configured = status.data?.configured === true;
  const files = useGetTreasuryDriveFilesQuery(undefined, { skip: !configured });

  const [scanDrive, { isLoading: scanning }] = useScanTreasuryDriveMutation();
  const [importFile, { isLoading: importing }] = useImportTreasuryDriveFileMutation();
  const [ignoreFile] = useIgnoreTreasuryDriveFileMutation();

  const [pollUntil, setPollUntil] = useState<number | null>(null);
  const [dialogTarget, setDialogTarget] = useState<TreasuryDriveFile | null>(null);

  // Tudo que justifica olhar o servidor de novo, derivado só do que ele já respondeu.
  const inProgress = (files.data ?? []).some((file) => file.status === "importing");
  const shouldPoll = configured && (inProgress || pollUntil !== null);

  const refetchStatus = status.refetch;
  const refetchFiles = files.refetch;

  // Mesmo padrão lint-safe do sibling de vendas/abastecimento: o efeito
  // depende só do booleano `shouldPoll` (derivado puro do resultado das
  // queries), nunca de um ref ou de `Date.now()` lido durante o render.
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
      toast.success(
        result.status === "already_running"
          ? "Já há uma sincronização em andamento."
          : "Sincronização iniciada. Os arquivos aparecem abaixo em instantes.",
      );
    } catch (error) {
      toast.error(messageOf(error, "Não foi possível iniciar a sincronização. Tente novamente."));
    }
  }

  // Nunca importa direto — só abre o diálogo para o operador confirmar conta e período.
  const handleImport = useCallback((file: TreasuryDriveFile) => setDialogTarget(file), []);

  const handleConfirmImport = useCallback(
    async (confirmation: DriveImportConfirmation) => {
      if (!dialogTarget) return;
      try {
        await importFile({ id: dialogTarget.id, accountId: confirmation.accountId, period: confirmation.period }).unwrap();
        keepWatching();
        setDialogTarget(null);
        toast.success("Importação iniciada. Acompanhe o processamento no histórico abaixo.");
      } catch (error) {
        // O servidor refaz suas próprias conferências; se recusar, a mensagem dele é a que aparece.
        toast.error(messageOf(error, "Não foi possível importar o arquivo."));
      }
    },
    [dialogTarget, importFile, keepWatching],
  );

  const handleIgnore = useCallback(
    (file: TreasuryDriveFile, ignored: boolean) => {
      ignoreFile({ id: file.id, ignored })
        .unwrap()
        .catch((error) => toast.error(messageOf(error, ignored ? "Não foi possível ignorar o arquivo." : "Não foi possível restaurar o arquivo.")));
    },
    [ignoreFile],
  );

  const rows = useMemo(() => files.data ?? [], [files.data]);
  const syncBusy = scanning;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="treasury-drive-files-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="treasury-drive-files-title" className="text-sm font-medium">
            Arquivos no Drive
          </h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Extratos de Itaú e C6 que caem no Google Drive todo mês — confira o banco e o tipo detectado antes de
            importar.
          </p>
        </div>
        {canWrite && configured && (
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
          // para a largura mínima da página, mesma correção do sibling de ingestão.
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
                    <TableHead>Banco</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((file) => (
                    <DriveFileRow key={file.id} file={file} canWrite={canWrite} onImport={handleImport} onIgnore={handleIgnore} />
                  ))}
                </TableBody>
              </Table>
            </RequestState>
          </div>
        )}
      </RequestState>

      <DriveImportDialog
        file={dialogTarget}
        pending={importing}
        onOpenChange={(open) => !open && setDialogTarget(null)}
        onConfirm={handleConfirmImport}
      />
    </section>
  );
}
