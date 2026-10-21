"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Loader2, Lock, PackageX, Tag, Wallet } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import { RequestState } from "@/components/request-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetClientQuery, useGetClientsQuery } from "@/lib/api/billing";
import { useGetClientDivergencesQuery, type ClientDivergenceFilters, type ClientDivergenceReport } from "@/lib/api/client-reports";
import { PERIOD_NOTE, PRICE_NOTE, fileBase, formatInstant, lossText, partialNote, periodText, priceText, totalText, unitsText, unitsWithRows } from "@/lib/client-reports/model";
import { shortcutRange, type Shortcut } from "@/lib/client-reports/shortcuts";
import { count } from "@/lib/format";

const PAGE_SIZE = 25;

const SHORTCUTS: Array<{ id: Shortcut; label: string }> = [
  { id: "last7", label: "Últimos 7 dias" },
  { id: "currentMonth", label: "Mês atual" },
  { id: "previousMonth", label: "Mês anterior" },
];

const same = (a: ClientDivergenceFilters | null, b: ClientDivergenceFilters | null) =>
  a !== null && b !== null && a.clientId === b.clientId && a.from === b.from && a.to === b.to && [...a.storeIds].sort().join() === [...b.storeIds].sort().join();

function Indicator({ icon: Icon, label, value, hint }: { icon: typeof Wallet; label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="tabular text-xl font-semibold">{value}</p>
          {hint ? <p className="text-xs text-warning">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Relatórios para clientes: as divergências "Outro motivo" (internamente "Outros (roubo)") de um cliente, por unidade e
 * período, a preço de venda. Tela, PDF e Excel saem do MESMO resultado da última consulta — nada é recalculado no
 * navegador —, e os botões de exportar só valem enquanto os filtros na tela são os da consulta feita.
 */
export function ClientReportsTab() {
  const today = useMemo(() => shortcutRange("last7"), []);
  const [clientId, setClientId] = useState<number | null>(null);
  const [storeIds, setStoreIds] = useState<number[]>([]);
  const [from, setFrom] = useState(today.from);
  const [to, setTo] = useState(today.to);
  const [applied, setApplied] = useState<ClientDivergenceFilters | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<"pdf" | "excel" | null>(null);

  const clients = useGetClientsQuery();
  const client = useGetClientQuery(clientId ?? 0, { skip: clientId === null });
  const units = useMemo(
    () => (client.data?.sites ?? []).filter((site) => site.store_id !== null).map((site) => ({ storeId: site.store_id as number, code: site.code })).sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })),
    [client.data],
  );

  const query = useGetClientDivergencesQuery(applied as ClientDivergenceFilters, { skip: applied === null });
  const draft: ClientDivergenceFilters | null = clientId === null ? null : { clientId, storeIds, from, to };
  const stale = applied !== null && !same(applied, draft);
  // A response belongs to the filters it was asked with; while a new query loads, the old one is not shown as current.
  const report: ClientDivergenceReport | undefined = query.isFetching ? undefined : query.currentData;
  const documentUnits = report ? unitsWithRows(report) : [];

  const invalid = clientId === null ? "Escolha o cliente." : from === "" || to === "" ? "Informe as duas datas." : from > to ? "A data inicial não pode ser maior que a final." : null;

  function pickClient(value: string) {
    setClientId(Number(value));
    setStoreIds([]); // units of the previous client are not units of this one
  }

  function toggleUnit(storeId: number, checked: boolean) {
    setStoreIds((current) => (checked ? [...current, storeId] : current.filter((id) => id !== storeId)));
  }

  function consult() {
    if (draft === null || invalid) return;
    setPage(0);
    if (same(applied, draft)) void query.refetch();
    else setApplied(draft);
  }

  function applyShortcut(shortcut: Shortcut) {
    const range = shortcutRange(shortcut);
    setFrom(range.from);
    setTo(range.to);
  }

  async function exportPdf() {
    if (!report) return;
    setBusy("pdf");
    try {
      const [{ pdf }, { ClientReportPdf }] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/client-reports/pdf")]);
      const origin = window.location.origin;
      const issuedOn = new Date().toLocaleDateString("pt-BR");
      const blob = await pdf(<ClientReportPdf report={report} logoSrc={`${origin}/brand/lockup-dark.png`} contourSrc={`${origin}/brand/contour.png`} issuedOn={issuedOn} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileBase(report, "pdf");
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Exportar PDF falhou", error);
      toast.error("Não foi possível gerar o PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function exportExcel() {
    if (!report) return;
    setBusy("excel");
    try {
      const { downloadClientReportWorkbook } = await import("@/lib/client-reports/excel");
      await downloadClientReportWorkbook(report, fileBase(report, "xlsx"));
    } catch (error) {
      console.error("Exportar Excel falhou", error);
      toast.error("Não foi possível gerar a planilha.");
    } finally {
      setBusy(null);
    }
  }

  const rows = documentUnits.flatMap((unit) => unit.rows.map((row, index) => ({ unit, row, last: index === unit.rows.length - 1 })));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const exportBlocked = !report || stale || busy !== null || rows.length === 0;
  const exportWhy = !report ? "Consulte primeiro." : stale ? "Os filtros mudaram: consulte de novo para exportar o que está na tela." : rows.length === 0 ? "Não há divergências para exportar." : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-report-client">Cliente</Label>
              <Select value={clientId === null ? undefined : String(clientId)} onValueChange={pickClient} disabled={clients.isLoading}>
                <SelectTrigger id="client-report-client" className="w-full">
                  <SelectValue placeholder={clients.isLoading ? "Carregando clientes..." : "Selecione o cliente"} />
                </SelectTrigger>
                <SelectContent>
                  {(clients.data ?? []).map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Unidades</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal" disabled={clientId === null || client.isLoading} aria-label="Unidades">
                    {clientId === null ? "Escolha o cliente primeiro" : storeIds.length === 0 ? "Todas as unidades" : `${storeIds.length} ${storeIds.length === 1 ? "unidade" : "unidades"}`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64">
                  <div className="flex flex-col gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setStoreIds([])} disabled={storeIds.length === 0}>
                      Todas as unidades
                    </Button>
                    {units.length === 0 ? <p className="text-sm text-muted-foreground">Este cliente não tem unidades com loja vinculada.</p> : null}
                    {units.map((unit) => (
                      <label key={unit.storeId} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={storeIds.includes(unit.storeId)} onCheckedChange={(checked) => toggleUnit(unit.storeId, checked === true)} />
                        {unit.code}
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-report-from">Data inicial</Label>
              <Input id="client-report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-report-to">Data final</Label>
              <Input id="client-report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={consult} disabled={invalid !== null || query.isFetching} title={invalid ?? undefined}>
                {query.isFetching ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Consultar
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {SHORTCUTS.map((shortcut) => (
              <Button key={shortcut.id} variant="secondary" size="sm" onClick={() => applyShortcut(shortcut.id)}>
                {shortcut.label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">{PERIOD_NOTE}</span>
            <Badge variant="secondary" className="ml-auto gap-1">
              <Lock className="size-3" aria-hidden /> Somente Outros (roubo)
            </Badge>
          </div>
          {invalid && (clientId !== null || from === "" || to === "" || from > to) ? <p role="alert" className="text-sm text-destructive">{invalid}</p> : null}
        </CardContent>
      </Card>

      {applied === null ? (
        <p className="text-sm text-muted-foreground">Escolha o cliente e o período e toque em &ldquo;Consultar&rdquo;.</p>
      ) : (
        <RequestState isLoading={query.isFetching} error={query.error} onRetry={() => void query.refetch()} loadingRows={6}>
          {report ? (
            <div className="flex flex-col gap-4">
              {stale ? (
                <p role="status" className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <AlertTriangle className="size-4 text-warning" aria-hidden /> Os filtros mudaram desde a última consulta. Os resultados abaixo e as exportações continuam sendo os da consulta anterior: toque em &ldquo;Consultar&rdquo; para atualizar.
                </p>
              ) : null}

              <div className="grid gap-3 md:grid-cols-3">
                <Indicator icon={Wallet} label="Perdas a preço de venda" value={totalText(report.totals.loss_cents, report.totals.partial)} hint={report.totals.partial ? partialNote(report.totals.unpriced_rows) : undefined} />
                <Indicator icon={PackageX} label="Itens em falta" value={unitsText(report.totals.quantity).replace("un.", "unidades")} />
                <Indicator icon={Tag} label="Produtos distintos" value={count(report.totals.distinct_products)} />
              </div>

              {report.unsplit_visits > 0 ? (
                <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    {report.unsplit_visits} {report.unsplit_visits === 1 ? "visita do período tem" : "visitas do período têm"} retiradas cujo motivo não foi guardado (relatório importado antes de o motivo ser gravado por visita): essas perdas não aparecem aqui até o mês ser importado de novo.
                  </span>
                </p>
              ) : null}

              <Card>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">Divergências encontradas</h2>
                      <p className="text-sm text-muted-foreground">
                        {report.client.name} • {periodText(report)}
                      </p>
                    </div>
                    <div className="flex gap-2" title={exportWhy}>
                      <Button variant="outline" onClick={() => void exportPdf()} disabled={exportBlocked}>
                        {busy === "pdf" ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />} Exportar PDF
                      </Button>
                      <Button variant="outline" onClick={() => void exportExcel()} disabled={exportBlocked}>
                        {busy === "excel" ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />} Exportar Excel
                      </Button>
                    </div>
                  </div>

                  {rows.length === 0 ? (
                    <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">Nenhuma divergência encontrada no período.</p>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Unidade</TableHead>
                            <TableHead>Produto</TableHead>
                            <TableHead className="text-right">Qtd. em falta</TableHead>
                            <TableHead>Conferência anterior</TableHead>
                            <TableHead>Falta identificada em</TableHead>
                            <TableHead className="text-right">Venda unitária</TableHead>
                            <TableHead className="text-right">Valor da perda</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visible.map(({ unit, row, last }, index) => (
                            <Fragment key={`${unit.store_id}-${row.sku}-${row.identified_at}-${page}-${index}`}>
                              <TableRow>
                                <TableCell>{unit.code}</TableCell>
                                <TableCell>
                                  <div>{row.product_name}</div>
                                  <div className="text-xs text-muted-foreground">SKU {row.sku}</div>
                                </TableCell>
                                <TableCell className="tabular text-right">{unitsText(row.quantity)}</TableCell>
                                <TableCell className="tabular bg-primary/5">{formatInstant(row.previous_conference_at)}</TableCell>
                                <TableCell className="tabular bg-primary/5">{formatInstant(row.identified_at)}</TableCell>
                                <TableCell className={`tabular text-right ${row.unit_price_cents === null ? "text-warning" : ""}`}>{priceText(row)}</TableCell>
                                <TableCell className={`tabular text-right ${row.loss_cents === null ? "text-warning" : ""}`}>{lossText(row)}</TableCell>
                              </TableRow>
                              {last ? (
                                <TableRow className="bg-primary/10 font-medium">
                                  <TableCell colSpan={2}>Total da unidade {unit.code}</TableCell>
                                  <TableCell className="tabular text-right">{unitsText(unit.total_quantity)}</TableCell>
                                  <TableCell colSpan={3} className="text-xs font-normal text-muted-foreground">{unit.partial ? partialNote(unit.unpriced_rows) : ""}</TableCell>
                                  <TableCell className="tabular text-right">{totalText(unit.total_loss_cents, unit.partial)}</TableCell>
                                </TableRow>
                              ) : null}
                            </Fragment>
                          ))}
                          {page === pages - 1 ? (
                            <TableRow className="bg-primary text-primary-foreground hover:bg-primary">
                              <TableCell colSpan={2} className="font-semibold">Total geral</TableCell>
                              <TableCell className="tabular text-right font-semibold">{unitsText(report.totals.quantity)}</TableCell>
                              <TableCell colSpan={3} />
                              <TableCell className="tabular text-right font-semibold">{totalText(report.totals.loss_cents, report.totals.partial)}</TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>

                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                          {count(rows.length)} {rows.length === 1 ? "ocorrência" : "ocorrências"}
                        </span>
                        <div className="flex items-center gap-2">
                          <span>
                            {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} de {rows.length}
                          </span>
                          <Button variant="ghost" size="icon" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage(page - 1)}>
                            <ChevronLeft aria-hidden />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Próxima página" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                            <ChevronRight aria-hidden />
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {PRICE_NOTE} Cada produto tem o seu próprio intervalo entre conferências. A paginação só afeta esta tela: o PDF e o Excel trazem todas as ocorrências da consulta.
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </RequestState>
      )}
    </div>
  );
}
