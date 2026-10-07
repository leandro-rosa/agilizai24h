"use client";

import Link from "next/link";
import { Landmark } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreatePricingParametersMutation,
  useGetPricingParametersQuery,
  useGetPricingParameterVersionQuery,
  useGetPricingParameterVersionsQuery,
  type PricingParameterVersion,
} from "@/lib/api/pricing";
import { useGetFeesInForceQuery } from "@/lib/api/treasury";
import { date, money } from "@/lib/format";
import type { PricingReportMeta } from "@/lib/api/pricing";
import { classifiableAccounts, incompleteSummary } from "@/lib/pricing/operating";
import { buildPatch, OPERATING_CLASS_LABEL, SELECTABLE_CLASSES, toForm, type RulesForm } from "@/lib/pricing/rules-form";

const METHOD_LABEL: Record<string, string> = { pix: "PIX", debit: "Débito", credit: "Crédito", voucher: "VR/VA" };
const CONFIDENCE_OPTIONS = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
] as const;

/** Todos os problemas de uma vez: o backend devolve a lista, e a tela a mostra inteira. */
function problemsOf(error: unknown): string[] {
  const data = (error as { data?: { problems?: unknown; message?: unknown } } | undefined)?.data;
  if (Array.isArray(data?.problems)) return data.problems.map(String);
  if (typeof data?.message === "string") return [data.message];

  return ["Não foi possível salvar. Nada foi alterado."];
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const NO_CLASS = "none";

/**
 * Como cada despesa da DRE se comporta frente ao preço de UM produto. Só as que acompanham a venda (percentual ou por transação) entram no preço;
 * deslocamento, custos fixos e custos de outras atividades (coffee break, frutas) ficam de fora e vão para a viabilidade da operação. Conta sem classe
 * fica de fora do preço e o cálculo sai marcado como incompleto — nunca é atribuída em silêncio.
 */
function OperatingClasses({ operating, behavior, onChange, readOnly }: { operating: PricingReportMeta["operating"]; behavior: Record<string, string>; onChange: (behavior: Record<string, string>) => void; readOnly: boolean }) {
  const accounts = classifiableAccounts(operating);
  const summary = incompleteSummary(operating);
  if (accounts.length === 0) return null;

  return (
    <section aria-labelledby="rule-operating" className="flex flex-col gap-2 rounded-lg border p-3">
      <h3 id="rule-operating" className="text-sm font-semibold">Despesas da DRE e como se comportam</h3>
      <p className="text-xs text-muted-foreground">
        Só o que acompanha a venda entra no preço (a margem de contribuição). Deslocamento, custos fixos e custos de outras atividades vão para a viabilidade da operação.
      </p>
      {summary && (
        <p role="alert" className="rounded-md border border-warning/30 bg-warning/12 p-2 text-xs text-warning">
          {summary}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => {
          const value = behavior[account.code] ?? (account.locked ? "already_component" : "");

          return (
            <li key={account.code} className="grid grid-cols-[1fr_minmax(0,16rem)] items-center gap-2 text-sm">
              <span>
                {account.code} {account.label} <span className="tabular text-xs text-muted-foreground">{money(account.amountCents)}</span>
              </span>
              {account.locked ? (
                <span className="text-xs text-muted-foreground">{OPERATING_CLASS_LABEL.already_component}</span>
              ) : (
                <Select value={value === "" ? NO_CLASS : value} onValueChange={(next) => onChange({ ...behavior, [account.code]: next === NO_CLASS ? "" : next })} disabled={readOnly}>
                  <SelectTrigger aria-label={`Classe de ${account.code} ${account.label}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLASS}>Sem classificação</SelectItem>
                    {SELECTABLE_CLASSES.map((name) => (
                      <SelectItem key={name} value={name}>
                        {OPERATING_CLASS_LABEL[name]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FeesInForce() {
  const { data, isLoading } = useGetFeesInForceQuery();

  return (
    <section aria-labelledby="fees-in-force" className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="fees-in-force" className="text-sm font-semibold">Taxas de pagamento em vigor</h3>
        <Link href="/treasury/fees" className="text-xs underline underline-offset-2">
          Cadastrar ou alterar taxas
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">Vêm da Tesouraria e não são editadas aqui, para não existirem em dois lugares.</p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {(data?.rates ?? []).map((rate) => (
            <li key={`${rate.acquirer}-${rate.payment_method}`} className="flex justify-between gap-2">
              <span>
                {rate.acquirer} · {METHOD_LABEL[rate.payment_method] ?? rate.payment_method}
              </span>
              <span className="tabular">
                {(rate.rate_bps / 100).toFixed(2).replace(".", ",")}%{rate.fixed_cents > 0 ? ` + ${money(rate.fixed_cents)} por venda` : ""}
              </span>
            </li>
          ))}
          {(data?.methods_without_rate ?? []).map((method) => (
            <li key={method} className="flex justify-between gap-2 text-warning">
              <span>{METHOD_LABEL[method] ?? method}</span>
              <span>Sem taxa cadastrada</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * As regras de preço, centralizadas. Salvar cria uma NOVA versão — nunca edita uma antiga — e passa a valer no próximo cálculo
 * do relatório. Taxas e perdas continuam vindo dos módulos que as têm. O corpo só existe com o modal aberto, então fechar e
 * reabrir sempre começa limpo, na versão em vigor.
 */
export function RulesDialog({
  open,
  onOpenChange,
  categories,
  canEdit,
  operating = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: { key: string; label: string }[];
  canEdit: boolean;
  /** As despesas que o relatório em tela leu, para o dono dizer como cada uma se comporta. */
  operating?: PricingReportMeta["operating"];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <RulesBody onClose={() => onOpenChange(false)} categories={categories} canEdit={canEdit} operating={operating} />}
    </Dialog>
  );
}

function RulesBody({ onClose, categories, canEdit, operating }: { onClose: () => void; categories: { key: string; label: string }[]; canEdit: boolean; operating: PricingReportMeta["operating"] }) {
  const { data: current } = useGetPricingParametersQuery();
  const { data: versions } = useGetPricingParameterVersionsQuery();
  const [viewing, setViewing] = useState<number | null>(null);
  const looksAtOlder = viewing !== null && viewing !== current?.id;
  const { data: older } = useGetPricingParameterVersionQuery(viewing ?? 0, { skip: !looksAtOlder });
  const shown: PricingParameterVersion | undefined = looksAtOlder ? older : current;

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Landmark aria-hidden className="size-4" />
          Regras de negócio
        </DialogTitle>
        <DialogDescription>
          Margens, arredondamento, preço psicológico, vendas mínimas e confiança mínima. Salvar cria uma nova versão e vale a partir do próximo cálculo do relatório.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Versão:</span>
        <Select value={String(viewing ?? current?.id ?? "")} onValueChange={(value) => setViewing(Number(value))}>
          <SelectTrigger className="w-72" aria-label="Versão das regras">
            <SelectValue placeholder="Carregando…" />
          </SelectTrigger>
          <SelectContent>
            {(versions ?? []).map((version) => (
              <SelectItem key={version.id} value={String(version.id)}>
                Versão {version.id}
                {version.id === current?.id ? " (em vigor)" : ""} · {date(version.createdAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {looksAtOlder && <StatusBadge tone="neutral">Somente leitura: versão antiga</StatusBadge>}
      </div>

      {shown && current ? (
        <RulesForm key={shown.id} version={shown} current={current} categories={categories} operating={operating} readOnly={!canEdit || looksAtOlder} onClose={onClose} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando regras…
        </p>
      )}
    </DialogContent>
  );
}

function RulesForm({
  version,
  current,
  categories,
  operating,
  readOnly,
  onClose,
}: {
  version: PricingParameterVersion;
  /** A versão em vigor: o patch é sempre calculado contra ela, que é de onde a nova versão nasce. */
  current: PricingParameterVersion;
  categories: { key: string; label: string }[];
  operating: PricingReportMeta["operating"];
  readOnly: boolean;
  onClose: () => void;
}) {
  const [save, { isLoading: saving }] = useCreatePricingParametersMutation();
  const [form, setForm] = useState<RulesForm>(() => toForm(version.values));
  const [problems, setProblems] = useState<string[]>([]);

  const built = useMemo(() => buildPatch(form, current.values), [form, current]);
  const set = (patch: Partial<RulesForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const changed = Object.keys(built.patch).length > 0;

  async function submit() {
    if (!changed) return;
    if (built.invalid.length > 0) {
      setProblems(built.invalid.map((label) => `${label}: valor inválido`));
      return;
    }
    try {
      const created = await save({ values: built.patch as never, note: "Alterado pela tela de Precificação Inteligente" }).unwrap();
      toast.success(`Regras salvas (versão ${created.id}). Valem a partir do próximo cálculo — use "Recalcular".`);
      onClose();
    } catch (error) {
      setProblems(problemsOf(error));
    }
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rule-target" label="Margem-alvo (%)" hint="Meta padrão para todos os produtos.">
            <Input id="rule-target" inputMode="decimal" value={form.targetPct} onChange={(e) => set({ targetPct: e.target.value })} disabled={readOnly} />
          </Field>
          <Field id="rule-minimum" label="Margem mínima (%)" hint="Abaixo disso a margem fica em vermelho.">
            <Input id="rule-minimum" inputMode="decimal" value={form.minimumPct} onChange={(e) => set({ minimumPct: e.target.value })} disabled={readOnly} />
          </Field>
          <Field id="rule-tax" label="Alíquota de imposto (%)" hint={form.taxRatePct === "" ? "Sem alíquota o motor não recomenda preço nenhum." : "Usada em toda a estrutura de custos."}>
            <Input id="rule-tax" inputMode="decimal" value={form.taxRatePct} onChange={(e) => set({ taxRatePct: e.target.value })} disabled={readOnly} />
          </Field>
          <Field id="rule-units" label="Quantidade mínima de vendas (un./mês)" hint="Abaixo disso a confiança cai.">
            <Input id="rule-units" inputMode="numeric" value={form.minUnitsPerMonth} onChange={(e) => set({ minUnitsPerMonth: e.target.value })} disabled={readOnly} />
          </Field>
          <Field id="rule-rounding" label="Arredondamento (R$)" hint="O preço sobe até o múltiplo seguinte.">
            <Input id="rule-rounding" inputMode="decimal" value={form.roundingStepReais} onChange={(e) => set({ roundingStepReais: e.target.value })} disabled={readOnly} />
          </Field>
          <Field id="rule-confidence" label="Nível mínimo de confiança" hint="Abaixo dele o preço não é mostrado como recomendação.">
            <Select value={form.minConfidence} onValueChange={(value) => set({ minConfidence: value as RulesForm["minConfidence"] })} disabled={readOnly}>
              <SelectTrigger id="rule-confidence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFIDENCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.psychologicalEnabled} onChange={(e) => set({ psychologicalEnabled: e.target.checked })} disabled={readOnly} />
            Preço psicológico
          </label>
          <Field id="rule-ending" label="Centavos finais">
            <Input id="rule-ending" className="w-24" inputMode="numeric" value={form.psychologicalEnding} onChange={(e) => set({ psychologicalEnding: e.target.value })} disabled={readOnly || !form.psychologicalEnabled} />
          </Field>
        </div>

        <section aria-labelledby="rule-categories" className="flex flex-col gap-2">
          <h3 id="rule-categories" className="text-sm font-semibold">Margem por categoria</h3>
          <p className="text-xs text-muted-foreground">Deixe em branco para usar a padrão.</p>
          <div className="flex flex-col gap-2">
            {categories.map((category) => {
              const value = form.categories[category.key] ?? { targetPct: "", minimumPct: "" };
              const update = (patch: Partial<typeof value>) => set({ categories: { ...form.categories, [category.key]: { ...value, ...patch } } });

              return (
                <div key={category.key} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 text-sm">
                  <span>{category.label}</span>
                  <Input aria-label={`Meta de ${category.label} (%)`} placeholder="Meta %" inputMode="decimal" value={value.targetPct} onChange={(e) => update({ targetPct: e.target.value })} disabled={readOnly} />
                  <Input aria-label={`Mínima de ${category.label} (%)`} placeholder="Mín. %" inputMode="decimal" value={value.minimumPct} onChange={(e) => update({ minimumPct: e.target.value })} disabled={readOnly} />
                </div>
              );
            })}
          </div>
        </section>

        <OperatingClasses operating={operating} behavior={form.behavior} onChange={(behavior) => set({ behavior })} readOnly={readOnly} />

        <Field id="rule-aliases" label="Apelidos de bandeira e adquirente" hint="Um por linha, nome=nome. A venda diz SODEXO, a taxa está cadastrada como Pluxee.">
          <Textarea id="rule-aliases" rows={3} value={form.aliases} onChange={(e) => set({ aliases: e.target.value })} disabled={readOnly} />
        </Field>

        <FeesInForce />

        {problems.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/12 p-3 text-sm text-destructive">
            <p className="font-medium">Nada foi salvo. Corrija:</p>
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
        {!readOnly && (
          <Button onClick={submit} disabled={!changed || saving}>
            {saving ? "Salvando…" : "Salvar nova versão"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
