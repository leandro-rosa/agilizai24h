"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { describeFinding, describeIngestionStatus, FILE_TYPE_LABELS, missingDatesOf } from "@/lib/drive-findings";
import type { DriveFile, DriveImportableFileType, ImportDriveFileArgs } from "@/lib/api/ingestion";
import { date, period as periodLabel } from "@/lib/format";

export type DriveImportConfirmation = Pick<ImportDriveFileArgs, "confirm_replace" | "confirm_validation">;

/**
 * O que a pessoa está prestes a confirmar, na cara: as inconsistências que a
 * validação achou (com as datas que faltam) e o período que será substituído.
 * Cada uma exige o seu próprio “li e confirmo” — a confirmação da revisão vai
 * atrelada ao hash do conteúdo que ela viu, então um arquivo editado depois
 * não herda um “ok” antigo.
 */
function DialogBody({
  file,
  fileType,
  period,
  pending,
  onCancel,
  onConfirm,
}: {
  file: DriveFile;
  fileType: DriveImportableFileType;
  period: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (confirmation: DriveImportConfirmation) => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  const needsReview = file.validation?.outcome === "needs_validation";
  const inconsistencies = file.validation?.inconsistencies ?? [];
  const replace = file.would_replace;
  const ready = (!needsReview || reviewed) && (!replace || replaceConfirmed);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Importar {file.name}</DialogTitle>
        <DialogDescription>
          {FILE_TYPE_LABELS[fileType]} · {periodLabel(period)}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {needsReview && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">A validação encontrou inconsistências</p>
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border p-3 text-sm">
              {inconsistencies.map((finding, index) => {
                const dates = missingDatesOf(finding);
                return (
                  <li key={`${finding.code}-${index}`}>
                    {describeFinding(finding)}
                    {dates.length > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">Sem registro em: {dates.join(", ")}</span>}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-start gap-2">
              <Checkbox id="drive-reviewed" checked={reviewed} onCheckedChange={(value) => setReviewed(value === true)} />
              <Label htmlFor="drive-reviewed" className="text-sm font-normal leading-snug">
                Revisei as inconsistências e confirmo a importação deste arquivo.
              </Label>
            </div>
          </div>
        )}

        {replace && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Isto vai substituir os dados de {FILE_TYPE_LABELS[fileType].toLowerCase()} de {periodLabel(period)} já ingeridos em {date(replace.ingested_at)} (situação:{" "}
                {describeIngestionStatus(replace.status)}). O financeiro e o estoque desse período serão recalculados.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="drive-replace" checked={replaceConfirmed} onCheckedChange={(value) => setReplaceConfirmed(value === true)} />
              <Label htmlFor="drive-replace" className="text-sm font-normal leading-snug">
                Entendo que os dados já ingeridos deste período serão substituídos.
              </Label>
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button
          disabled={!ready || pending}
          onClick={() =>
            onConfirm({
              confirm_replace: replace ? true : undefined,
              confirm_validation: needsReview && file.validation ? { content_sha256: file.validation.contentSha256 } : undefined,
            })
          }
        >
          {pending ? "Importando…" : "Importar"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DriveImportDialog({
  target,
  pending,
  onOpenChange,
  onConfirm,
}: {
  /** null = fechado. */
  target: { file: DriveFile; fileType: DriveImportableFileType; period: string } | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (confirmation: DriveImportConfirmation) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {target && (
          // A chave zera os “li e confirmo” a cada arquivo e a cada nova abertura.
          <DialogBody
            key={`${target.file.id}:${target.file.validation?.contentSha256 ?? ""}:${target.period}`}
            file={target.file}
            fileType={target.fileType}
            period={target.period}
            pending={pending}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
