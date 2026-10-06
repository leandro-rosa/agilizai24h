"use client";

import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supplierAnalysisApi } from "@/lib/api/supplier-analysis";
import { useGetProductsQuery, useUpdateProductMutation } from "@/lib/api/products";
import {
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABELS,
  useAddAliasMutation,
  useCreateSupplierMutation,
  useGetSuppliersQuery,
  useResolveSuppliersMutation,
  type Supplier,
  type SupplierCategory,
} from "@/lib/api/suppliers";
import type { SheetRow } from "@/lib/catalogue-sync/parse-sheet";
import {
  fold,
  groupSheetSuppliers,
  planReview,
  suggestSuppliers,
  type Decision,
  type SheetSupplierGroup,
} from "@/lib/catalogue-sync/supplier-review";
import { useAppDispatch } from "@/lib/hooks";

const UNSET = "unset";
const SKIP = "skip";
const CREATE = "create";
const PARALLEL = 4;

/** Roda `work` sobre os itens, `PARALLEL` por vez, e devolve as falhas. */
async function inBatches<T>(items: T[], work: (item: T) => Promise<void>): Promise<{ item: T; error: unknown }[]> {
  const failures: { item: T; error: unknown }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return failures;
}

/**
 * Revisão dos fornecedores da planilha: cada nome vira uma decisão do operador
 * (vincular a um cadastrado, criar, ou pular). Nada é inferido nem gravado antes
 * da confirmação, e produto que já tem fornecedor nunca é sobrescrito.
 */
export function SupplierReview({ rows }: { rows: SheetRow[] }) {
  const dispatch = useAppDispatch();
  const productsQuery = useGetProductsQuery();
  const suppliersQuery = useGetSuppliersQuery({ status: "active" });
  const [resolve] = useResolveSuppliersMutation();
  const [createSupplier] = useCreateSupplierMutation();
  const [addAlias] = useAddAliasMutation();
  const [updateProduct] = useUpdateProductMutation();

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const suppliers = useMemo(() => suppliersQuery.data ?? [], [suppliersQuery.data]);
  const groups = useMemo(() => groupSheetSuppliers(rows, products), [rows, products]);
  const [resolved, setResolved] = useState<Map<string, Supplier>>(new Map());
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  // Aliases já confirmados em sincronizações anteriores casam sozinhos (e continuam sendo só uma sugestão).
  useEffect(() => {
    const spellings = [...new Set(groups.flatMap((g) => g.spellings))];
    if (spellings.length === 0) return;
    resolve(spellings)
      .unwrap()
      .then((r) => setResolved(new Map(r.matched.map((m) => [fold(m.name), m.supplier]))))
      .catch(() => setResolved(new Map()));
  }, [groups, resolve]);

  const plan = useMemo(() => planReview(groups, decisions), [groups, decisions]);
  const set = (key: string, decision: Decision | null) =>
    setDecisions((current) => {
      const next = new Map(current);
      if (decision) next.set(key, decision);
      else next.delete(key);
      return next;
    });

  async function apply() {
    setBusy(true);
    const lines: string[] = [];
    let linked = 0;
    let failedProducts = 0;

    try {
      for (const { group, decision } of plan.steps) {
        let supplierId: number;
        if (decision.kind === "create") {
          const created = await createSupplier({ name: decision.name.trim(), category: decision.category }).unwrap();
          supplierId = created.id;
          lines.push(`Fornecedor criado: ${created.name}`);
        } else {
          supplierId = decision.supplierId;
        }

        // A grafia da planilha vira alias: a próxima sincronização já casa. Conflito (alias de outro) não impede o vínculo.
        for (const spelling of group.spellings) await addAlias({ id: supplierId, alias: spelling }).unwrap().catch(() => undefined);

        const failures = await inBatches(group.toLink, async (product) => {
          await updateProduct({ id: product.id, changes: { supplierId } }).unwrap();
          linked++;
        });
        failedProducts += failures.length;
      }

      dispatch(supplierAnalysisApi.util.invalidateTags(["Analysis"]));
      setReport(`${linked} produtos vinculados${failedProducts ? `, ${failedProducts} com erro (tente de novo: só os que faltam serão tentados)` : ""}.${lines.length ? ` ${lines.join("; ")}.` : ""}`);
      setDecisions(new Map());
      if (failedProducts) toast.error("Alguns vínculos falharam.");
      else toast.success(`${linked} produtos vinculados.`);
    } catch {
      toast.error("Não foi possível concluir. O que já foi gravado fica; revise e tente de novo.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const pending = groups.filter((g) => g.toLink.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-primary" /> Fornecedores da planilha
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          A planilha diz de qual fornecedor é cada produto. Confirme, nome por nome, a qual fornecedor cadastrado ele corresponde: o painel só sugere, e produto que já tem fornecedor não é alterado. Os
          produtos novos da etapa acima só entram aqui depois de aplicados.
        </p>
        {report && <p className="rounded-md border p-2 text-sm">{report}</p>}
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum produto do catálogo está sem fornecedor segundo a planilha.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome na planilha</TableHead>
                <TableHead className="text-right">Produtos a vincular</TableHead>
                <TableHead>Fornecedor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((group) => (
                <ReviewRow key={group.key} group={group} suppliers={suppliers} resolved={resolved} decision={decisions.get(group.key)} onChange={(d) => set(group.key, d)} />
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center gap-3">
          <Button disabled={plan.steps.length === 0 || busy} onClick={() => setConfirming(true)}>
            Revisar e vincular ({plan.products} produtos)
          </Button>
          <span className="text-xs text-muted-foreground">{plan.suppliersToCreate > 0 ? `${plan.suppliersToCreate} fornecedor(es) novo(s) serão cadastrados. ` : ""}Nada é gravado antes de confirmar.</span>
        </div>
      </CardContent>
      <Dialog open={confirming} onOpenChange={(open) => !open && !busy && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar vínculos</DialogTitle>
            <DialogDescription>
              {plan.products} produtos serão vinculados a {plan.steps.length} fornecedor(es)
              {plan.suppliersToCreate > 0 ? `, criando ${plan.suppliersToCreate}` : ""}. A grafia da planilha passa a ser alias do fornecedor.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 overflow-y-auto text-sm">
            {plan.steps.map(({ group, decision }) => (
              <li key={group.key}>
                {group.label} ({group.toLink.length}) →{" "}
                {decision.kind === "create" ? `novo: ${decision.name}` : (suppliers.find((s) => s.id === decision.supplierId)?.name ?? `#${decision.supplierId}`)}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button disabled={busy} onClick={apply}>
              {busy ? "Gravando..." : "Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ReviewRow({
  group,
  suppliers,
  resolved,
  decision,
  onChange,
}: {
  group: SheetSupplierGroup;
  suppliers: Supplier[];
  resolved: Map<string, Supplier>;
  decision: Decision | undefined;
  onChange: (decision: Decision | null) => void;
}) {
  const suggestion = useMemo(() => suggestSuppliers(group, suppliers, resolved), [group, suppliers, resolved]);
  const value = !decision ? UNSET : decision.kind === "link" ? String(decision.supplierId) : decision.kind === "create" ? CREATE : SKIP;
  const suggested = suggestion.confident ?? (suggestion.candidates.length === 1 ? suggestion.candidates[0] : null);

  return (
    <TableRow>
      <TableCell className="font-medium">
        {group.label}
        {group.alreadyLinked > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">({group.alreadyLinked} já com fornecedor, não mudam)</span>}
      </TableCell>
      <TableCell className="tabular text-right">{group.toLink.length}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={value}
            onValueChange={(next) => {
              if (next === UNSET) onChange(null);
              else if (next === SKIP) onChange({ kind: "skip" });
              else if (next === CREATE) onChange({ kind: "create", name: group.label, category: "grocery" });
              else onChange({ kind: "link", supplierId: Number(next) });
            }}
          >
            <SelectTrigger className="w-64" aria-label={`Fornecedor de ${group.label}`}>
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Decidir depois</SelectItem>
              <SelectItem value={SKIP}>Pular</SelectItem>
              <SelectItem value={CREATE}>Criar fornecedor…</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!decision && suggested && (
            <Button size="sm" variant="outline" onClick={() => onChange({ kind: "link", supplierId: suggested.id })}>
              {suggestion.confident ? "Usar" : "Sugestão:"} {suggested.name}
            </Button>
          )}
          {!decision && !suggested && suggestion.candidates.length > 1 && (
            <span className="text-xs text-muted-foreground">Parecidos: {suggestion.candidates.map((c) => c.name).join(", ")}</span>
          )}
          {decision?.kind === "create" && (
            <>
              <Input
                className="w-48"
                aria-label={`Nome do novo fornecedor ${group.label}`}
                value={decision.name}
                onChange={(e) => onChange({ ...decision, name: e.target.value })}
              />
              <Select value={decision.category} onValueChange={(category) => onChange({ ...decision, category: category as SupplierCategory })}>
                <SelectTrigger className="w-40" aria-label="Categoria">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPLIER_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {SUPPLIER_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
