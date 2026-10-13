"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CalendarDays, FileDown, Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { DriveFilesSection } from "@/components/ingestion/drive-files-section";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toCents } from "@/components/resource-form-dialog";
import { useGetProductsQuery } from "@/lib/api/products";
import { useGetSuppliersQuery } from "@/lib/api/suppliers";
import {
  useAddConsignmentCostMutation,
  useConfirmClosingMutation,
  useGetClosingStatusQuery,
  useGetConsignmentCostsQuery,
  useGetOpenTotalQuery,
  useGetSettlementsQuery,
  useCancelSettlementMutation,
  usePaySettlementMutation,
  usePreviewClosingMutation,
  type ClosingExtraPick,
  type HomeStockEntry,
  type ClosingPreview,
  type RemovalKind,
  type LegacyLine,
  type Settlement,
  type SettlementState,
} from "@/lib/api/purchases";
import { coverageWithHome, issueText, nextAfter, overlapsLast, pickedTotal, pickKey, picksOf, rangeOfLength, verdictOf } from "@/lib/purchases/closing";
import { formatCents, formatDate } from "@/lib/purchases/money";

const STATE_LABEL: Record<SettlementState, string> = { proposal: "Proposta", confirmed: "Confirmado (a pagar)", paid: "Pago", cancelled: "Cancelado" };
const STATE_TONE: Record<SettlementState, StatusTone> = { proposal: "attention", confirmed: "neutral", paid: "positive", cancelled: "critical" };
const today = () => new Date().toISOString().slice(0, 10);
const message = (failure: unknown, fallback: string) => (failure as { data?: { message?: string } })?.data?.message ?? fallback;

type Range = { from: string; to: string };
type Result = { key: string; preview: ClosingPreview } | { key: string; error: string };

/** Fechamentos de fornecedores: consulta explícita de um período (só lê), confirmação que gera a dívida, e o histórico. */
export function ClosingScreen() {
  const openTotal = useGetOpenTotalQuery();
  const [tab, setTab] = useState("new");
  const [detail, setDetail] = useState<Settlement | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm" className="max-w-sm">
        <CardHeader>
          <CardTitle className="text-sm font-normal text-muted-foreground">A pagar (fechamentos confirmados)</CardTitle>
        </CardHeader>
        <CardContent className="tabular text-2xl font-semibold">{openTotal.data ? formatCents(openTotal.data.confirmed_cents) : "—"}</CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger value="new">Novo fechamento</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="new">
          <NewClosing
            onConfirmed={(settlement) => {
              setTab("history");
              setDetail(settlement);
            }}
          />
        </TabsContent>
        <TabsContent value="history">
          <History onOpen={setDetail} />
        </TabsContent>
      </Tabs>

      <DetailDialog settlement={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function NewClosing({ onConfirmed }: { onConfirmed: (settlement: Settlement) => void }) {
  const suppliers = (useGetSuppliersQuery().data ?? []).filter((s) => s.status === "active").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const [preview] = usePreviewClosingMutation();
  const [confirm, { isLoading: confirming }] = useConfirmClosingMutation();

  const [supplierId, setSupplierId] = useState("");
  const [edited, setEdited] = useState<Range | null>(null);
  const [length, setLength] = useState("custom");
  const [result, setResult] = useState<Result | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [acceptIncomplete, setAcceptIncomplete] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingExtras, setPendingExtras] = useState<ClosingExtraPick[]>([]);
  const [pendingHome, setPendingHome] = useState<HomeStockEntry[]>([]);
  const [synced, setSynced] = useState(false);
  // Só a última consulta pode escrever o resultado: uma resposta atrasada de uma seleção anterior é descartada.
  const latest = useRef(0);

  const id = Number(supplierId) || 0;
  const status = useGetClosingStatusQuery({ supplierId: id }, { skip: !id });
  const suggested = status.data?.suggested ?? null;
  const range: Range = edited ?? suggested ?? { from: "", to: "" };
  const key = `${id}|${range.from}|${range.to}`;
  const fresh = result?.key === key;
  const supplierName = suppliers.find((s) => s.id === id)?.name ?? "";
  const configured = status.data ? status.data.configured_skus > 0 : null;
  const rangeInvalid = !range.from || !range.to || range.to < range.from;
  const overlap = overlapsLast(status.data?.last ?? null, range.from, range.to);

  function chooseSupplier(value: string) {
    latest.current++;
    setLoading(false);
    setSupplierId(value);
    setEdited(null);
    setLength("custom");
    setResult(null);
    setAcceptIncomplete(false);
  }

  function changeRange(next: Range, keepLength = false) {
    latest.current++;
    setLoading(false);
    setEdited(next);
    if (!keepLength) setLength("custom");
    setAcceptIncomplete(false);
  }

  /** Fechar a sincronização invalida o resultado: o que foi importado pode mudar o valor, então só uma nova consulta vale. */
  function onSyncOpenChange(open: boolean) {
    setSyncOpen(open);
    if (!open) {
      latest.current++;
      setLoading(false);
      setResult(null);
      setSynced(true);
    }
  }

  async function consult() {
    const ticket = ++latest.current;
    const asked = key;
    setResult(null);
    setSynced(false);
    setLoading(true);
    try {
      const response = await preview({ supplier_id: id, period_from: range.from, period_to: range.to }).unwrap();
      if (ticket === latest.current) setResult({ key: asked, preview: response });
    } catch (failure) {
      if (ticket === latest.current) setResult({ key: asked, error: message(failure, "Não foi possível consultar o período.") });
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }

  async function onConfirm(view: ClosingPreview) {
    try {
      const settlement = await confirm({ supplier_id: view.supplier_id, period_from: view.period_from, period_to: view.period_to, accept_incomplete: acceptIncomplete, extras: pendingExtras, home_stock: pendingHome }).unwrap();
      setConfirmOpen(false);
      setResult(null);
      toast.success("Fechamento confirmado: agora conta como valor a pagar.");
      onConfirmed(settlement);
    } catch (failure) {
      setConfirmOpen(false);
      toast.error(message(failure, "Não foi possível confirmar o fechamento."));
    }
  }

  const needsSetup = configured === false;
  const view = fresh && result && "preview" in result ? result.preview : null;
  const failed = fresh && result && "error" in result ? result.error : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Fornecedor
            <Select value={supplierId} onValueChange={chooseSupplier}>
              <SelectTrigger className="w-64" aria-label="Fornecedor do fechamento">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Período
            <Select
              value={length}
              onValueChange={(value) => {
                setLength(value);
                if (value !== "custom" && range.from) changeRange(rangeOfLength(range.from, Number(value)), true);
              }}
            >
              <SelectTrigger className="w-44" aria-label="Duração do fechamento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Semanal · 7 dias</SelectItem>
                <SelectItem value="10">10 dias</SelectItem>
                <SelectItem value="15">15 dias</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Início
            <Input
              type="date"
              value={range.from}
              max={today()}
              onChange={(e) => changeRange(length !== "custom" && e.target.value ? rangeOfLength(e.target.value, Number(length)) : { from: e.target.value, to: range.to }, length !== "custom")}
              aria-label="Primeiro dia do fechamento"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Fim
            <Input type="date" value={range.to} max={today()} onChange={(e) => changeRange({ from: range.from, to: e.target.value })} aria-label="Último dia do fechamento" />
          </label>
          <Button onClick={consult} disabled={!id || isLoading || needsSetup || rangeInvalid}>
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <CalendarDays className="size-4" />}
            {isLoading ? "Consultando..." : "Consultar período"}
          </Button>
          <Button variant="outline" onClick={() => setSyncOpen(true)}>
            <RefreshCw className="size-4" />
            Sincronizar vendas e abastecimento
          </Button>
        </CardContent>
      </Card>

      {!id && <p className="text-sm text-muted-foreground">Escolha o fornecedor para ver o último fechamento e o próximo período.</p>}
      {id > 0 && <LastLine status={status.data} loading={status.isLoading} supplierName={supplierName} />}
      {id > 0 && suggested && (range.from !== suggested.from || range.to !== suggested.to) && (
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="suggestion">
          Próximo período a fechar: {formatDate(suggested.from)} a {formatDate(suggested.to)}.
          <Button size="sm" variant="outline" onClick={() => changeRange(suggested)}>
            Usar este período
          </Button>
        </p>
      )}
      {id > 0 && overlap && status.data?.last && (
        <p role="alert" data-testid="overlap-warning" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 p-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" />O último fechamento termina em {formatDate(status.data.last.period_to)} e este período começa em {formatDate(range.from)}: eles se sobrepõem.
          <Button size="sm" variant="outline" onClick={() => changeRange({ from: nextAfter(status.data!.last!), to: range.to >= nextAfter(status.data!.last!) ? range.to : nextAfter(status.data!.last!) })}>
            Começar em {formatDate(nextAfter(status.data.last))}
          </Button>
        </p>
      )}

      {needsSetup && id > 0 && <SetupPanel supplierName={supplierName} onOpen={() => setSetupOpen(true)} />}

      {id > 0 && !needsSetup && !isLoading && !view && !failed && (
        <p role="status" data-testid="stale-note" className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <Info className="size-4 shrink-0" />
          {synced ? "Vendas e abastecimento sincronizados? Clique em Consultar período para recalcular." : result ? "Período alterado. Clique em Consultar período." : "Escolha o período e clique em Consultar período para calcular."}
        </p>
      )}
      {isLoading && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Consultando {supplierName} de {formatDate(range.from)} a {formatDate(range.to)}...
        </p>
      )}
      {failed && (
        <div role="alert" data-testid="query-error" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm">
          <StatusBadge tone="critical">Erro ao consultar</StatusBadge>
          <span>{failed}</span>
          <Button size="sm" variant="outline" onClick={consult}>
            Tentar de novo
          </Button>
        </div>
      )}
      {view && (
        <ResultView
          view={view}
          acceptIncomplete={acceptIncomplete}
          onAccept={setAcceptIncomplete}
          onConfirm={(picks, home) => {
            setPendingExtras(picks);
            setPendingHome(home);
            setConfirmOpen(true);
          }}
          onUseFrom={(from) => changeRange({ from, to: range.to >= from ? range.to : from })}
          onSetup={() => setSetupOpen(true)}
          onSync={() => setSyncOpen(true)}
        />
      )}

      <Dialog open={syncOpen} onOpenChange={onSyncOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Sincronizar vendas e abastecimento</DialogTitle>
            <DialogDescription>
              Procura no Drive os relatórios novos. Nada é importado sozinho: confira cada arquivo e clique em “Importar”. Ao fechar, consulte o período de novo.
            </DialogDescription>
          </DialogHeader>
          <DriveFilesSection />
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar fechamento?</DialogTitle>
            <DialogDescription>
              {view ? `${view.supplier_name} · ${formatDate(view.period_from)} a ${formatDate(view.period_to)} · ${formatCents(view.total_cents + pickedTotal(view.removals?.lines ?? [], new Set(pendingExtras.map((p) => pickKey(p.sku, p.month, p.kind)))).cents)}` : ""}
              {view && pendingExtras.length > 0 ? ` (vendido ${formatCents(view.total_cents)} + ${pendingExtras.length} retirada(s) escolhida(s))` : ""}. 
              Passa a contar como valor a pagar e esses dias não poderão ser repassados de novo. O sistema não paga: o “pago” é só o registro.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Voltar
            </Button>
            <Button onClick={() => view && onConfirm(view)} disabled={confirming}>
              {confirming ? "Confirmando..." : "Confirmar fechamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {id > 0 && <CostsDialog supplierId={id} supplierName={supplierName} open={setupOpen} onOpenChange={setSetupOpen} firstDay={suggested?.from || range.from || today()} />}
    </div>
  );
}

function LastLine({ status, loading, supplierName }: { status: ReturnType<typeof useGetClosingStatusQuery>["data"]; loading: boolean; supplierName: string }) {
  if (loading || !status) return null;
  const last = status.last;

  return (
    <p data-testid="last-settlement" className="text-sm text-muted-foreground">
      {last
        ? `Último fechamento de ${supplierName}: ${formatDate(last.period_from)} a ${formatDate(last.period_to)} · ${last.state === "paid" ? `pago em ${formatDate(last.paid_on)}` : "confirmado, aguardando pagamento"} · ${formatCents(last.owed_cents)}. Os detalhes estão no Histórico.`
        : `Nenhum fechamento confirmado ainda para ${supplierName}.`}
    </p>
  );
}

function SetupPanel({ supplierName, onOpen }: { supplierName: string; onOpen: () => void }) {
  const steps = [
    { n: 1, title: "Produtos consignados", text: "Selecione os produtos que serão fornecidos em consignação.", action: "Configurar produtos", enabled: true },
    { n: 2, title: "Custos de repasse", text: "Informe o custo de repasse de cada produto.", action: "Informar custos", enabled: true },
    { n: 3, title: "Estoque inicial", text: "Use o estoque que já existe para registrar o saldo inicial.", action: "Conferir saldo", enabled: false },
  ];

  return (
    <Card data-testid="setup-panel">
      <CardHeader>
        <CardTitle className="text-base">Prepare {supplierName} para o primeiro fechamento</CardTitle>
        <p className="text-sm text-muted-foreground">Use o estoque que já existe. Não é preciso criar uma compra fictícia.</p>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <div key={step.n} className="flex flex-col gap-2 rounded-md border p-3">
            <p className="font-medium">
              {step.n}. {step.title}
            </p>
            <p className="text-sm text-muted-foreground">{step.text}</p>
            <Button size="sm" variant={step.enabled ? "default" : "outline"} disabled={!step.enabled} onClick={onOpen} className="mt-auto w-fit">
              {step.action}
            </Button>
            {!step.enabled && <p className="text-xs text-muted-foreground">Ainda não é usado neste cálculo (vendas × custo de repasse). Não bloqueia o fechamento.</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ResultView({
  view,
  acceptIncomplete,
  onAccept,
  onConfirm,
  onUseFrom,
  onSetup,
  onSync,
}: {
  view: ClosingPreview;
  acceptIncomplete: boolean;
  onAccept: (value: boolean) => void;
  onConfirm: (picks: ClosingExtraPick[], home: HomeStockEntry[]) => void;
  onUseFrom: (from: string) => void;
  onSetup: () => void;
  onSync: () => void;
}) {
  const verdict = verdictOf(view);
  // O que a pessoa escolheu pagar além do vendido. Nasce vazio a cada consulta (este componente só existe enquanto há resultado).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Estoque em casa digitado pela pessoa (o sistema não o conhece): só vai ao servidor quando ela confirma, para ficar no PDF.
  const [home, setHome] = useState<Record<string, string>>({});
  const homeEntries: HomeStockEntry[] = Object.entries(home).filter(([, v]) => v.trim() !== "" && Number.isInteger(Number(v)) && Number(v) >= 0).map(([sku, v]) => ({ sku, units: Number(v) }));
  const extras = pickedTotal(view.removals?.lines ?? [], picked);
  const showNumbers = view.status === "ready" || view.status === "incomplete";
  const acceptable = view.issues.length > 0 && view.issues.every((i) => i.acceptable);
  const canConfirm = view.status === "ready" || (view.status === "incomplete" && acceptable && acceptIncomplete);

  return (
    <Card data-testid="closing-result">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            Resultado: {view.supplier_name} · {formatDate(view.period_from)} a {formatDate(view.period_to)}
          </CardTitle>
          <StatusBadge tone={verdict.tone}>{verdict.title}</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">{verdict.text}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.status === "conflict" && view.conflict && (
          <Button variant="outline" className="w-fit" onClick={() => onUseFrom(view.conflict!.suggested_from)}>
            Começar em {formatDate(view.conflict.suggested_from)}
          </Button>
        )}
        {view.status === "config_pending" && (
          <Button className="w-fit" onClick={onSetup}>
            Configurar produtos e custos
          </Button>
        )}
        {view.issues.some((i) => i.code === "sales_dates_missing" || i.code === "stores_missing") && (
          <Button variant="outline" className="w-fit" onClick={onSync}>
            <RefreshCw className="size-4" />
            Sincronizar vendas
          </Button>
        )}
        {view.issues.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm" data-testid="issues">
            {view.issues.map((issue, index) => (
              <li key={index} className="flex items-start gap-1">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                {issueText(issue)}
              </li>
            ))}
          </ul>
        )}

        {showNumbers && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Figure
                label="Valor a repassar"
                value={formatCents(view.total_cents + extras.cents)}
                note={extras.units > 0 ? `Vendido ${formatCents(view.total_cents)} + ${formatCents(extras.cents)} escolhidos (${extras.units} un.)` : "Só o vendido. Escolha vencidas ou outro motivo na aba ao lado para somar."}
              />
              <Figure label="Vendidas" value={`${view.total_units} un.`} />
              <Figure label="Vencidas (à parte)" value={cellText(view.removals?.totals.expired)} note={view.removals ? "Por mês, a custo de repasse. Entram só se você marcar." : "Abastecimento não pôde ser lido."} />
              <Figure label="Outro motivo (à parte)" value={cellText(view.removals?.totals.other_reason)} note={view.removals ? "Roubo: por conta do Agiliz. Entra só se você marcar." : "Abastecimento não pôde ser lido."} />
            </div>
            <Tabs defaultValue="sales">
              <TabsList variant="line">
                <TabsTrigger value="sales">Vendas e repasse</TabsTrigger>
                <TabsTrigger value="expiry">Vencidos e outro motivo</TabsTrigger>
                <TabsTrigger value="stock">Estoque</TabsTrigger>
              </TabsList>
              <TabsContent value="sales">
                <ClosingLinesTable lines={view.lines} totals={{ units: view.total_units, cents: view.total_cents }} />
                {view.skus_without_sales > 0 && <p className="mt-2 text-xs text-muted-foreground">{view.skus_without_sales} produto(s) configurado(s) sem venda no período.</p>}
                <p className="mt-1 text-xs text-muted-foreground">Conta: vendas da rede inteira dos produtos configurados × custo de repasse combinado, vigente no primeiro dia do período (MÉTRICA DERIVADA).</p>
              </TabsContent>
              <TabsContent value="expiry">
                <RemovalsTable removals={view.removals} picked={picked} onChange={setPicked} />
              </TabsContent>
              <TabsContent value="stock">
                <StockTable stock={view.stock} home={home} onHome={setHome} />
              </TabsContent>
            </Tabs>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {view.status === "incomplete" && acceptable && (
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={acceptIncomplete} onChange={(e) => onAccept(e.target.checked)} />
                  Confirmar mesmo incompleto (assumo o número)
                </label>
              )}
              <Button onClick={() => onConfirm(picksOf(picked), homeEntries)} disabled={!canConfirm}>
                Confirmar fechamento
              </Button>
            </div>
            {view.status === "incomplete" && !acceptable && <p className="text-right text-xs text-muted-foreground">Não dá para confirmar enquanto faltar custo ou data de venda.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** `12 un. · R$ 71,40`; sem custo, só as unidades (o valor é desconhecido, não zero). */
function cellText(cell: { units: number; cents: number | null } | undefined): string {
  if (!cell) return "Não disponível";
  return cell.cents === null ? `${cell.units} un. · sem custo` : `${cell.units} un. · ${formatCents(cell.cents)}`;
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]}/${month.slice(0, 4)}`;

/** Vencidas, outro motivo (roubo) e devolvidas por produto e mês, valoradas ao custo de repasse. Só informação: nada aqui altera o valor a repassar. */
function RemovalsTable({ removals, picked, onChange }: { removals: ClosingPreview["removals"]; picked: Set<string>; onChange: (next: Set<string>) => void }) {
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<"all" | "expired" | "other" | "returned">("all");
  if (!removals) return <p className="text-sm text-muted-foreground">Não foi possível ler as retiradas do abastecimento agora. Consulte de novo.</p>;
  const all = removals.lines.filter((l) => l.expired.units + l.other_reason.units + l.returned.units > 0);
  const needle = filter.trim().toLowerCase();
  const withKind = (l: (typeof all)[number]) => (show === "expired" ? l.expired.units > 0 : show === "other" ? l.other_reason.units > 0 : show === "returned" ? l.returned.units > 0 : true);
  const lines = all.filter((l) => withKind(l) && (!needle || l.name.toLowerCase().includes(needle) || l.sku.includes(needle)));
  // Com um filtro de tipo só as colunas desse tipo ficam: é a visão para mostrar ao fornecedor.
  const colExpired = show === "all" || show === "expired";
  const colOther = show === "all" || show === "other";
  const colReturned = show === "all" || show === "returned";
  const sum = (field: "expired" | "other_reason" | "returned") => {
    const units = lines.reduce((n, l) => n + l[field].units, 0);
    return { units, cents: lines.some((l) => l[field].units > 0 && l[field].cents === null) ? null : lines.reduce((n, l) => n + (l[field].cents ?? 0), 0) };
  };
  const total = { expired: sum("expired"), other_reason: sum("other_reason"), returned: sum("returned") };
  const datedOk = (month: string) => removals.scope.find((m) => m.month === month)?.dated_ok !== false;
  const toggle = (sku: string, month: string, kind: RemovalKind) => {
    const next = new Set(picked);
    const key = pickKey(sku, month, kind);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  const markExpiredOfFilter = () => {
    const next = new Set(picked);
    for (const l of lines) if (l.expired.units > 0 && l.expired.cents !== null && datedOk(l.month)) next.add(pickKey(l.sku, l.month, "expired"));
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="removals">
      <p className="text-sm text-muted-foreground">
        O abastecimento guarda só o <strong>mês</strong> de cada retirada, não o dia. Por isso cada mês é contado assim: no primeiro fechamento que o inclui, o mês inteiro; nos seguintes, só o que o mês acumulou depois do último fechamento. Valor = unidades × custo de repasse (ESTIMATIVA). Só entram no valor a repassar as que você marcar.
      </p>
      <ul className="flex flex-col gap-0.5 text-sm" data-testid="removals-scope">
        {removals.scope.map((m) => (
          <li key={m.month} className={m.dated_ok ? "" : "text-warning"}>
            {monthName(m.month)}: {m.mode === "whole_month" ? "mês inteiro (nenhum fechamento anterior contou este mês)" : `só o que veio depois do último fechamento (dados até ${formatDate(m.counted_since)})`}
            {m.data_until ? ` · abastecimento importado até ${formatDate(m.data_until)}` : ""}
            {!m.dated_ok ? ". O abastecimento vai além do fim do período: não dá para separar o que é do período, então não pode ser marcado. Escolha o fim do período em ou depois dessa data." : ""}
          </li>
        ))}
      </ul>
      {removals.months_without_data.length > 0 && (
        <p className="flex items-start gap-1 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          Sem abastecimento importado em {removals.months_without_data.map(monthName).join(", ")}: nada foi contado nesse mês.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Mostrar">
        {(
          [
            ["all", "Todos"],
            ["expired", "Com vencidas"],
            ["other", "Com outro motivo"],
            ["returned", "Com devolvidas"],
          ] as const
        ).map(([value, label]) => (
          <Button key={value} size="sm" variant={show === value ? "default" : "outline"} aria-pressed={show === value} onClick={() => setShow(value)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-56" placeholder="Filtrar produto ou SKU" aria-label="Filtrar produto das retiradas" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button size="sm" variant="outline" onClick={markExpiredOfFilter} disabled={lines.every((l) => l.expired.units === 0)}>
          Marcar vencidas {needle ? "do filtro" : "de todos"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(new Set())} disabled={picked.size === 0}>
          Limpar escolha
        </Button>
        <span className="text-xs text-muted-foreground">Marque o que você quer pagar neste fechamento: o valor a repassar soma só o marcado.</span>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma retirada vencida, por outro motivo ou devolvida dos produtos desse fornecedor nesses meses.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Mês</TableHead>
              {colExpired && <TableHead className="text-right">Vencidas</TableHead>}
              {colExpired && <TableHead className="text-right">Valor vencidas</TableHead>}
              {colOther && <TableHead className="text-right">Outro motivo</TableHead>}
              {colOther && <TableHead className="text-right">Valor outro motivo</TableHead>}
              {colReturned && <TableHead className="text-right">Devolvidas</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={`${line.sku}-${line.month}`}>
                <TableCell>{line.name}</TableCell>
                <TableCell>{monthName(line.month)}</TableCell>
                {colExpired && <TableCell className="tabular text-right">{line.expired.units}</TableCell>}
                {colExpired && (
                <TableCell className="tabular text-right">
                  <label className="inline-flex items-center justify-end gap-1.5">
                    {line.expired.units > 0 && (
                      <input
                        type="checkbox"
                        aria-label={`Pagar vencidas de ${line.name} em ${monthName(line.month)}`}
                        checked={picked.has(pickKey(line.sku, line.month, "expired"))}
                        disabled={line.expired.cents === null || !datedOk(line.month)}
                        onChange={() => toggle(line.sku, line.month, "expired")}
                      />
                    )}
                    {line.expired.cents === null ? "sem custo" : formatCents(line.expired.cents)}
                  </label>
                </TableCell>
                )}
                {colOther && <TableCell className="tabular text-right">{line.other_reason.units}</TableCell>}
                {colOther && (
                <TableCell className="tabular text-right">
                  <label className="inline-flex items-center justify-end gap-1.5">
                    {line.other_reason.units > 0 && (
                      <input
                        type="checkbox"
                        aria-label={`Pagar outro motivo de ${line.name} em ${monthName(line.month)}`}
                        checked={picked.has(pickKey(line.sku, line.month, "other_reason"))}
                        disabled={line.other_reason.cents === null || !datedOk(line.month)}
                        onChange={() => toggle(line.sku, line.month, "other_reason")}
                      />
                    )}
                    {line.other_reason.cents === null ? "sem custo" : formatCents(line.other_reason.cents)}
                  </label>
                </TableCell>
                )}
                {colReturned && <TableCell className="tabular text-right">{line.returned.units}</TableCell>}
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">{show === "all" && !needle ? "Total" : "Total do que está na tela"}</TableCell>
              <TableCell />
              {colExpired && <TableCell className="tabular text-right font-semibold">{total.expired.units}</TableCell>}
              {colExpired && <TableCell className="tabular text-right font-semibold">{total.expired.cents === null ? "—" : formatCents(total.expired.cents)}</TableCell>}
              {colOther && <TableCell className="tabular text-right font-semibold">{total.other_reason.units}</TableCell>}
              {colOther && <TableCell className="tabular text-right font-semibold">{total.other_reason.cents === null ? "—" : formatCents(total.other_reason.cents)}</TableCell>}
              {colReturned && <TableCell className="tabular text-right font-semibold">{total.returned.units}</TableCell>}
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** O que sobrou nas lojas por produto, com o ritmo de venda e a cobertura em dias; o estoque em casa a pessoa digita. É aritmética, não recomendação de compra. */
function StockTable({ stock, home, onHome }: { stock: ClosingPreview["stock"]; home: Record<string, string>; onHome: (next: Record<string, string>) => void }) {
  const [onlyStock, setOnlyStock] = useState(false);
  if (!stock) return <p className="text-sm text-muted-foreground">Não foi possível ler o saldo das lojas no abastecimento agora. Consulte de novo.</p>;
  const rows = onlyStock ? stock.filter((l) => (l.in_stores ?? 0) > 0 || Number(home[l.sku] ?? 0) > 0) : stock;
  const homeOf = (sku: string) => (Number.isInteger(Number(home[sku])) && Number(home[sku]) >= 0 ? Number(home[sku] || 0) : 0);

  return (
    <div className="flex flex-col gap-3" data-testid="stock">
      <p className="text-sm text-muted-foreground">
        <strong>Nas lojas</strong>: saldo registrado na última visita de cada loja (o abastecimento não conhece o estoque central nem o que está em casa). <strong>Em casa</strong>: digite o que você tem, só para esta conta e para o PDF do fechamento. Cobertura = (lojas + casa) ÷ vendidas por dia no período.
      </p>
      <label className="flex w-fit items-center gap-1.5 text-sm">
        <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />
        Só produtos com estoque
      </label>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead className="text-right">Nas lojas</TableHead>
            <TableHead>Última visita</TableHead>
            <TableHead className="text-right">Em casa</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Vendidas</TableHead>
            <TableHead className="text-right">Por dia</TableHead>
            <TableHead className="text-right">Cobertura (dias)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((line) => {
            const cover = coverageWithHome(line, homeOf(line.sku));
            return (
              <TableRow key={line.sku}>
                <TableCell>{line.name}</TableCell>
                <TableCell className="tabular text-right">{line.in_stores === null ? "sem registro" : line.in_stores}</TableCell>
                <TableCell className="tabular">
                  {line.last_visit ? formatDate(line.last_visit) : "—"}
                  {line.oldest_store_visit && line.oldest_store_visit < (line.last_visit ?? "") && <span className="ml-1 text-xs text-warning">algumas lojas desde {formatDate(line.oldest_store_visit)}</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="ml-auto w-20 text-right"
                    inputMode="numeric"
                    aria-label={`Estoque em casa de ${line.name}`}
                    value={home[line.sku] ?? ""}
                    onChange={(e) => onHome({ ...home, [line.sku]: e.target.value })}
                  />
                </TableCell>
                <TableCell className="tabular text-right">{line.in_stores === null && !home[line.sku] ? "—" : (line.in_stores ?? 0) + homeOf(line.sku)}</TableCell>
                <TableCell className="tabular text-right">{line.sold_units}</TableCell>
                <TableCell className="tabular text-right">{line.per_day === null ? "—" : String(line.per_day).replace(".", ",")}</TableCell>
                <TableCell className="tabular text-right">{cover === null ? "—" : String(cover).replace(".", ",")}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular text-xl font-semibold">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** O total vem do servidor quando existe (é o que será confirmado); sem ele, a soma das linhas. */
function ClosingLinesTable({ lines, totals }: { lines: { sku: string; name: string; sold_units: number; unit_cost_cents: number; total_cents: number }[]; totals?: { units: number; cents: number } }) {
  const units = totals?.units ?? lines.reduce((s, l) => s + l.sold_units, 0);
  const total = totals?.cents ?? lines.reduce((s, l) => s + l.total_cents, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Produto</TableHead>
          <TableHead className="text-right">Vendidas</TableHead>
          <TableHead className="text-right">Custo</TableHead>
          <TableHead className="text-right">Repasse</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.sku}>
            <TableCell>{line.name}</TableCell>
            <TableCell className="tabular text-right">{line.sold_units}</TableCell>
            <TableCell className="tabular text-right">{formatCents(line.unit_cost_cents)}</TableCell>
            <TableCell className="tabular text-right">{formatCents(line.total_cents)}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="tabular text-right font-semibold">{units}</TableCell>
          <TableCell />
          <TableCell className="tabular text-right font-semibold">{formatCents(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** Produtos consignados do fornecedor com o custo de repasse de cada um; um custo nunca é editado, a correção é outra vigência. */
function CostsDialog({ supplierId, supplierName, open, onOpenChange, firstDay }: { supplierId: number; supplierName: string; open: boolean; onOpenChange: (open: boolean) => void; firstDay: string }) {
  const products = useGetProductsQuery().data ?? [];
  const costs = useGetConsignmentCostsQuery({ supplierId }, { skip: !open });
  const [add, { isLoading }] = useAddConsignmentCostMutation();
  const [sku, setSku] = useState("");
  const [cost, setCost] = useState("");
  const [from, setFrom] = useState("");

  const nameOf = (code: string) => products.find((p) => p.sku === code)?.name ?? code;
  const known = products.find((p) => p.sku === sku.trim());
  const validFrom = from || firstDay || today();

  async function save() {
    if (!known) return void toast.error("Escolha um SKU que exista no cadastro de produtos.");
    const cents = toCents(cost);
    if (!cost.trim() || cents < 0) return void toast.error("Informe o custo de repasse por unidade, em reais.");
    try {
      await add({ supplierId, sku: known.sku, valid_from: validFrom, unit_cost_cents: cents }).unwrap();
      toast.success(`${known.name}: custo de ${formatCents(cents)} desde ${formatDate(validFrom)}.`);
      setSku("");
      setCost("");
    } catch (failure) {
      toast.error(message(failure, "Não foi possível salvar o custo."));
    }
  }

  const rows = costs.data?.costs ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Produtos consignados e custos de repasse</DialogTitle>
          <DialogDescription>{supplierName}. Cada produto com custo vira consignado. Um custo não se edita: para corrigir, informe outro com a nova data de início.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Produto (SKU)
            <Input list="closing-skus" value={sku} onChange={(e) => setSku(e.target.value)} className="w-40" aria-label="SKU do produto consignado" />
            <datalist id="closing-skus">
              {products.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Custo de repasse (R$)
            <Input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className="w-32" aria-label="Custo de repasse por unidade" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Vale desde
            <Input type="date" value={validFrom} onChange={(e) => setFrom(e.target.value)} aria-label="Início da vigência do custo" />
          </label>
          <Button onClick={save} disabled={isLoading}>
            Adicionar
          </Button>
        </div>
        {sku.trim() && <p className="text-xs text-muted-foreground">{known ? known.name : "SKU não encontrado no cadastro."}</p>}
        <div className="max-h-64 overflow-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum produto consignado configurado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.sku}-${row.valid_from}`}>
                    <TableCell>
                      {nameOf(row.sku)} <span className="text-xs text-muted-foreground">{row.sku}</span>
                    </TableCell>
                    <TableCell className="tabular">{formatDate(row.valid_from)}</TableCell>
                    <TableCell className="tabular text-right">{formatCents(row.unit_cost_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function History({ onOpen }: { onOpen: (settlement: Settlement) => void }) {
  const history = useGetSettlementsQuery();
  const rows = history.data ?? [];

  return (
    <Card>
      <CardContent className="pt-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum fechamento ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((settlement) => (
                <TableRow key={settlement.id}>
                  <TableCell>{settlement.supplier_name}</TableCell>
                  <TableCell className="tabular">
                    {formatDate(settlement.period_from)} a {formatDate(settlement.period_to)}
                  </TableCell>
                  <TableCell className="tabular text-right">{formatCents(settlement.owed_cents)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={STATE_TONE[settlement.state]}>{settlement.state === "paid" ? `Pago em ${formatDate(settlement.paid_on)}` : STATE_LABEL[settlement.state]}</StatusBadge>
                    {settlement.kind === "legacy" && <span className="ml-2 text-xs text-muted-foreground">Histórico</span>}
                    {settlement.partial && <span className="ml-2 text-xs text-warning">incompleto</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => onOpen(settlement)}>
                      Ver detalhes
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DetailDialog({ settlement, onClose }: { settlement: Settlement | null; onClose: () => void }) {
  const [pay, { isLoading: paying }] = usePaySettlementMutation();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [cancel, { isLoading: cancelling }] = useCancelSettlementMutation();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  // O estado vem sempre da lista atualizada, não da cópia que abriu o diálogo.
  const history = useGetSettlementsQuery();
  const current = settlement ? (history.data?.find((s) => s.id === settlement.id) ?? settlement) : null;

  /** O PDF sai do que ficou gravado no fechamento, então é igual em qualquer dia. O renderizador só carrega aqui. */
  async function onPdf(settlement: Settlement) {
    setPdfBusy(true);
    try {
      const { closingPdfBlob } = await import("@/lib/purchases/closing-pdf");
      const url = URL.createObjectURL(await closingPdfBlob(settlement));
      const link = document.createElement("a");
      link.href = url;
      link.download = `fechamento-${(settlement.supplier_name ?? "fornecedor").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${settlement.period_from}-a-${settlement.period_to}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Não foi possível gerar o PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function onCancel() {
    if (!current) return;
    try {
      await cancel({ id: current.id, reason: reason.trim() }).unwrap();
      setCancelOpen(false);
      setReason("");
      toast.success("Fechamento cancelado. O período está livre para consultar e confirmar de novo.");
    } catch (failure) {
      toast.error(message(failure, "Não foi possível cancelar o fechamento."));
    }
  }

  async function onPay() {
    if (!current) return;
    try {
      await pay({ id: current.id, paid_on: paidOn, note: note || undefined }).unwrap();
      toast.success("Registrado como pago. (O painel não faz pagamento: é só o registro.)");
    } catch (failure) {
      toast.error(message(failure, "Não foi possível registrar o pagamento."));
    }
  }

  const legacy: LegacyLine[] = current?.evidence.legacy_lines ?? [];
  const closing = current?.evidence.closing_lines ?? [];

  return (
    <Dialog open={current !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {current && (
          <>
            <DialogHeader>
              <DialogTitle>
                {current.supplier_name} · {formatDate(current.period_from)} a {formatDate(current.period_to)}
              </DialogTitle>
              <DialogDescription>
                {formatCents(current.owed_cents)} · {STATE_LABEL[current.state]}
                {current.paid_on ? ` em ${formatDate(current.paid_on)}` : ""}
                {current.kind === "legacy" ? " · acerto histórico, feito fora do sistema" : ""} · origem: {current.evidence.source ?? "fechamento do painel"}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-80 overflow-auto">
              {current.kind === "legacy" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {legacy.map((line) => (
                      <TableRow key={`${line.name}-${line.sku ?? ""}`}>
                        <TableCell>{line.name}</TableCell>
                        <TableCell className="tabular text-right">{formatCents(line.unit_cost_cents)}</TableCell>
                        <TableCell className="tabular text-right">{line.quantity}</TableCell>
                        <TableCell className="tabular text-right">{formatCents(line.total_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <ClosingLinesTable lines={closing} totals={{ units: closing.reduce((n, l) => n + l.sold_units, 0), cents: closing.reduce((n, l) => n + l.total_cents, 0) }} />
              )}
            </div>
            {(current.evidence.extras ?? []).length > 0 && (
              <div className="flex flex-col gap-1" data-testid="detail-extras">
                <p className="text-sm font-medium">Vencidas e outro motivo escolhidas para pagar neste fechamento</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Mês</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Unidades</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(current.evidence.extras ?? []).map((e) => (
                      <TableRow key={`${e.sku}-${e.month}-${e.kind}`}>
                        <TableCell>{e.name}</TableCell>
                        <TableCell>{monthName(e.month)}</TableCell>
                        <TableCell>{e.kind === "expired" ? "Vencidas" : "Outro motivo"}</TableCell>
                        <TableCell className="tabular text-right">{e.units}</TableCell>
                        <TableCell className="tabular text-right">{formatCents(e.total_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {current.kind === "closing" && current.state !== "cancelled" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => onPdf(current)} disabled={pdfBusy}>
                  <FileDown className="size-4" />
                  {pdfBusy ? "Gerando PDF..." : "Baixar PDF para o fornecedor"}
                </Button>
                <span className="text-xs text-muted-foreground">Vendas, o que foi incluído, as retiradas e o que sobrou de cada item, como ficou gravado na confirmação.</span>
              </div>
            )}
            {current.state === "confirmed" && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Pago em
                  <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Data do pagamento" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Observação
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: PIX" aria-label="Observação do pagamento" />
                </label>
                <Button onClick={onPay} disabled={paying}>
                  {paying ? "Registrando..." : "Marcar como pago"}
                </Button>
              </div>
            )}
            {current.kind === "closing" && current.state === "confirmed" && (
              <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                <p className="text-sm text-muted-foreground">Errou a escolha de vencidas, outro motivo ou estoque? Cancele este fechamento (ele fica no histórico), consulte o período de novo e confirme com a correção.</p>
                {!cancelOpen ? (
                  <Button variant="outline" className="w-fit" onClick={() => setCancelOpen(true)}>
                    Cancelar fechamento
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Motivo (fica registrado)
                      <Input className="w-80" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo do cancelamento" placeholder="Ex.: faltou marcar o outro motivo" />
                    </label>
                    <Button variant="destructive" onClick={onCancel} disabled={cancelling || reason.trim().length < 3}>
                      {cancelling ? "Cancelando..." : "Confirmar cancelamento"}
                    </Button>
                    <Button variant="ghost" onClick={() => setCancelOpen(false)}>
                      Voltar
                    </Button>
                  </div>
                )}
              </div>
            )}
            {current.state === "cancelled" && current.evidence.cancelled && (
              <p className="text-sm text-muted-foreground" data-testid="cancelled-note">
                Cancelado em {formatDate(current.evidence.cancelled.at.slice(0, 10))}
                {current.evidence.cancelled.by ? ` por ${current.evidence.cancelled.by}` : ""}: {current.evidence.cancelled.reason}. Valor que tinha: {formatCents(current.evidence.cancelled.owed_cents)}.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
