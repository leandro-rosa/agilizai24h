"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TREASURY_SOURCE_ACCOUNT_HINT, TREASURY_SOURCE_LABELS, useGetAccountsQuery, type BankAccount, type TreasuryDriveFile } from "@/lib/api/treasury";

export interface DriveImportConfirmation {
  accountId: number;
  period: string;
}

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Nomes de mês em português por extenso, sem abreviação — mesma convenção de
 * `month_folder_name` no backend (pasta literal do Drive, ex. "agosto",
 * "setembro"; ver `TREASURY_DRIVE_MONTH_FOLDERS` e a allowlist de
 * `treasury-drive-source`). Não existe um utilitário equivalente do lado do
 * frontend nem uma lib compartilhada entre backend/frontend para reusar — o
 * mapeamento de `ingestion-worker-service/.../drive-source/utils/
 * suggestions.ts` é backend-only (módulo Node, sem build compartilhado com o
 * Next), então esta lista é escrita de novo aqui, escopada a este arquivo.
 */
const MONTH_NAMES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/** "2026-08-15T00:00:00.000Z" → "2026-08". Sem fuso: a data já vem em UTC. */
function periodFromModifiedTime(modifiedTime: string): string {
  const [iso] = modifiedTime.split("T");
  const [year, month] = iso.split("-");
  return `${year}-${month}`;
}

/**
 * O período sugerido para importação, combinando `month_folder_name` (o mês
 * real, mas sem ano — o nome da pasta do Drive) com `modified_time` (tem ano,
 * mas não é o mês do extrato: numa Google Sheet, `modified_time` reflete
 * quando a operadora editou a planilha por último, preenchendo as colunas
 * Tipo/Detalhe — tipicamente DEPOIS do fim do mês do extrato, nunca antes).
 * O exemplo real do design desta mudança: um extrato Itaú de agosto, editado
 * em setembro — usar só `modified_time` sugeriria "2026-09" para um extrato
 * de agosto.
 *
 * O ano vem do ano de `modified_time`, exceto quando o mês da pasta é
 * cronologicamente POSTERIOR ao mês de `modified_time` — só acontece quando o
 * arquivo foi editado no mês seguinte ao período que ele descreve, e esse mês
 * seguinte virou o ano (pasta "dezembro" editada em janeiro do ano seguinte);
 * nesse caso o ano volta um, porque a edição aconteceu depois da virada.
 *
 * `month_folder_name` que não bate com nenhum nome de mês reconhecido (não
 * deveria acontecer, dado a allowlist do próprio backend, mas defensivo)
 * cai no comportamento antigo, só `modified_time`.
 */
function periodOf(file: { month_folder_name: string; modified_time: string }): string {
  const modifiedTimePeriod = periodFromModifiedTime(file.modified_time);

  const folderMonth = MONTH_NAMES[file.month_folder_name.trim().toLowerCase()];
  if (folderMonth === undefined) return modifiedTimePeriod;

  const [modifiedYearRaw, modifiedMonthRaw] = modifiedTimePeriod.split("-");
  const modifiedYear = Number(modifiedYearRaw);
  const modifiedMonth = Number(modifiedMonthRaw);

  const year = folderMonth > modifiedMonth ? modifiedYear - 1 : modifiedYear;

  return `${year}-${String(folderMonth).padStart(2, "0")}`;
}

/**
 * A conta a pré-selecionar. "c6" sozinho não basta — a mesma pasta de banco
 * gera tanto `c6_statement` (conta corrente) quanto `c6_invoice` (cartão de
 * crédito), e há uma `BankAccount` de cada kind com o mesmo `institution`
 * (seed `20260826020000_seed_bank_accounts`). Por isso o par institution+kind
 * de `TREASURY_SOURCE_ACCOUNT_HINT[detected_source]` — o mesmo lookup que
 * `/treasury/imports/upload` já usa para sugerir conta por fonte — vem
 * primeiro; só cai para casar `bank_folder_name` sozinho (ex. arquivo sem
 * `detected_source` reconhecido, ou nenhuma conta com o par exato) para nunca
 * deixar de sugerir algo quando pelo menos o banco é conhecido. Comparação
 * sem caixa/espaço dos dois lados: o seed grava `institution` em minúsculo
 * ("c6", "itau"), e a pasta do Drive é o nome literal que alguém criou lá —
 * nunca confiar que os dois vêm normalizados do mesmo jeito.
 */
function matchAccount(accounts: BankAccount[], file: TreasuryDriveFile): BankAccount | null {
  if (file.detected_source) {
    const hint = TREASURY_SOURCE_ACCOUNT_HINT[file.detected_source];
    const byHint = accounts.find((account) => account.institution.trim().toLowerCase() === hint.institution && account.kind === hint.kind);
    if (byHint) return byHint;
  }
  const target = file.bank_folder_name.trim().toLowerCase();
  return accounts.find((account) => account.institution.trim().toLowerCase() === target) ?? null;
}

function DialogBody({
  file,
  pending,
  onCancel,
  onConfirm,
}: {
  file: TreasuryDriveFile;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (confirmation: DriveImportConfirmation) => void;
}) {
  const { data: accounts } = useGetAccountsQuery();
  const suggested = accounts ? matchAccount(accounts, file) : null;

  // Só o que a pessoa escolheu; enquanto for null, vale a sugestão — mesmo padrão de
  // `chosenType`/`chosenPeriod` em `components/ingestion/drive-file-row.tsx`. Derivar
  // assim (em vez de um `useState` inicializado por `suggested?.id` mais um `useEffect`
  // que o atualiza depois) evita depender de quando `accounts` chega: se a lista ainda
  // não tiver carregado no primeiro render, a sugestão aparece sozinha assim que
  // `useGetAccountsQuery` resolver, sem `setState` síncrono dentro de efeito (proibido
  // pelas regras de pureza do React Compiler deste app).
  const [chosenAccountId, setChosenAccountId] = useState<number | null>(null);
  const accountId = chosenAccountId ?? suggested?.id ?? null;

  const [period, setPeriod] = useState(periodOf(file));

  const periodIsValid = PERIOD_PATTERN.test(period);
  const ready = accountId !== null && periodIsValid;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Importar {file.name}</DialogTitle>
        <DialogDescription>
          {file.detected_source ? TREASURY_SOURCE_LABELS[file.detected_source] : "Tipo não reconhecido"} · pasta &quot;{file.bank_folder_name}&quot;
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="drive-import-account">Conta</Label>
          <Select value={accountId !== null ? String(accountId) : ""} onValueChange={(value) => setChosenAccountId(Number(value))}>
            <SelectTrigger id="drive-import-account" aria-label="Conta">
              <SelectValue placeholder="Selecione a conta" />
            </SelectTrigger>
            <SelectContent>
              {(accounts ?? []).map((account) => (
                <SelectItem key={account.id} value={String(account.id)}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="drive-import-period">Período</Label>
          <Input id="drive-import-period" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button disabled={!ready || pending} onClick={() => accountId !== null && onConfirm({ accountId, period })}>
          {pending ? "Importando…" : "Confirmar"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DriveImportDialog({
  file,
  pending,
  onOpenChange,
  onConfirm,
}: {
  /** null = fechado. */
  file: TreasuryDriveFile | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (confirmation: DriveImportConfirmation) => void;
}) {
  return (
    <Dialog open={file !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {file && (
          // A chave reinicia a escolha de conta/período a cada arquivo/abertura.
          <DialogBody key={file.id} file={file} pending={pending} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
        )}
      </DialogContent>
    </Dialog>
  );
}
