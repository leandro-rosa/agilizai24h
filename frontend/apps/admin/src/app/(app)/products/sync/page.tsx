"use client";

import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApplyCatalogueSyncMutation, usePreviewCatalogueSyncMutation, type SyncApplyResult, type SyncPlan } from "@/lib/api/products";
import { useHasPermission } from "@/lib/auth/use-permission";
import { money } from "@/lib/format";
import { parseSheet, type SheetRow } from "@/lib/catalogue-sync/parse-sheet";
import { lastCompleteMonth } from "@/lib/period-range";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Sincroniza o catálogo com a planilha de precificação. Fluxo: escolher o
 * arquivo → pré-visualizar (nada é gravado) → marcar o que aplicar → aplicar.
 * Só CRIA produtos novos e registra versões datadas de custo/preço; nunca
 * reescreve nome, categoria ou EAN de produto existente.
 */
export default function CatalogueSyncPage() {
  const canWrite = useHasPermission("products:write");
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [sel, setSel] = useState<{ create: Set<string>; costs: Set<string>; prices: Set<string> }>({ create: new Set(), costs: new Set(), prices: new Set() });
  const [newFrom, setNewFrom] = useState(`${lastCompleteMonth()}-01`);
  const [changeFrom, setChangeFrom] = useState(today());
  const [results, setResults] = useState<SyncApplyResult[] | null>(null);
  const [preview, { isLoading: previewing }] = usePreviewCatalogueSyncMutation();
  const [apply, { isLoading: applying }] = useApplyCatalogueSyncMutation();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setResults(null);
    setPlan(null);
    try {
      const parsed = parseSheet(await file.arrayBuffer());
      if (parsed.missingColumns.length) {
        toast.error(`Colunas obrigatórias não encontradas: ${parsed.missingColumns.join(", ")}.`);
        return;
      }
      setRows(parsed.rows);
      setFileName(file.name);
      const p = await preview({ rows: parsed.rows }).unwrap();
      setPlan(p);
      setSel({ create: new Set(p.create.map((c) => c.sku)), costs: new Set(p.costs.map((c) => c.sku)), prices: new Set(p.prices.map((c) => c.sku)) });
    } catch {
      toast.error("Não foi possível ler a planilha ou calcular a prévia.");
    }
  }

  const toggle = (kind: "create" | "costs" | "prices", sku: string) =>
    setSel((s) => {
      const next = new Set(s[kind]);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return { ...s, [kind]: next };
    });

  const total = sel.create.size + sel.costs.size + sel.prices.size;
  const blocked = useMemo(() => plan?.issues.filter((i) => i.severity === "blocked") ?? [], [plan]);

  async function onApply() {
    if (!rows || !plan) return;
    try {
      const r = await apply({
        rows,
        selection: { create: [...sel.create], costs: [...sel.costs], prices: [...sel.prices] },
        new_products_from: newFrom,
        changes_from: changeFrom,
      }).unwrap();
      setResults(r);
      const failed = r.filter((x) => !x.ok).length;
      if (failed) toast.error(`${r.length - failed} aplicados, ${failed} com erro.`);
      else toast.success(`${r.length} itens aplicados.`);
    } catch {
      toast.error("Não foi possível aplicar a sincronização.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sincronizar precificação"
        description="Cadastra os produtos novos da planilha de precificação e registra custo e preço com data de vigência. Nada é gravado antes de você confirmar."
        actions={<Link href="/products" className="text-sm text-primary hover:underline">← Produtos</Link>}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="size-4 text-primary" /> 1. Escolha a planilha
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input type="file" accept=".xlsx,.xls" onChange={(e) => onFile(e.target.files?.[0])} className="max-w-md" />
          <p className="text-xs text-muted-foreground">
            Baixe o <span className="font-medium">precificação(1).xlsx</span> do Drive e selecione aqui. Colunas lidas: SKU, Categoria, Subcategoria, EAN, Produto, Fornecedor, Custo Unitário, Preço Simulado, Medida.
            {fileName ? ` Arquivo atual: ${fileName} (${rows?.length ?? 0} linhas).` : ""} {previewing ? "Calculando prévia…" : ""}
          </p>
        </CardContent>
      </Card>

      {plan && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. O que mudaria</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                <span className="font-semibold">{plan.create.length}</span> produtos novos · <span className="font-semibold">{plan.costs.length}</span> mudanças de custo ·{" "}
                <span className="font-semibold">{plan.prices.length}</span> mudanças de preço · {plan.unchanged} já batem.
              </p>
              {blocked.length > 0 && <p className="text-destructive">{blocked.length} linha(s) bloqueada(s) abaixo não serão aplicadas.</p>}
            </CardContent>
          </Card>

          {plan.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-warning" /> Avisos ({plan.issues.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                  {plan.issues.map((i, n) => (
                    <li key={`${i.row}-${i.code}-${n}`} className={i.severity === "blocked" ? "text-destructive" : "text-muted-foreground"}>
                      <span className="tabular mr-2 text-xs">linha {i.row}</span>
                      {i.message}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {plan.create.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Produtos novos ({sel.create.size}/{plan.create.length} marcados)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>SKU</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.create.map((c) => (
                      <TableRow key={c.sku}>
                        <TableCell><Checkbox checked={sel.create.has(c.sku)} onCheckedChange={() => toggle("create", c.sku)} aria-label={`Cadastrar ${c.name}`} /></TableCell>
                        <TableCell className="tabular">{c.sku}</TableCell>
                        <TableCell className="whitespace-normal font-medium">{c.name}</TableCell>
                        <TableCell className="text-xs">{c.category}{c.subcategory ? ` · ${c.subcategory}` : ""}</TableCell>
                        <TableCell className="text-xs">{c.supplier ?? "—"}</TableCell>
                        <TableCell className="tabular text-right">{c.cost_cents === null ? <span className="text-warning">sem custo</span> : c.cost_cents === 0 ? <span className="text-warning">{money(0)}</span> : money(c.cost_cents)}</TableCell>
                        <TableCell className="tabular text-right">{c.price_cents === null ? "—" : money(c.price_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {(["costs", "prices"] as const).map((kind) =>
            plan[kind].length === 0 ? null : (
              <Card key={kind}>
                <CardHeader>
                  <CardTitle className="text-base">Mudanças de {kind === "costs" ? "custo" : "preço"} ({sel[kind].size}/{plan[kind].length} marcadas)</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>SKU</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Hoje</TableHead>
                        <TableHead className="text-right">Planilha</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plan[kind].map((c) => (
                        <TableRow key={c.sku}>
                          <TableCell><Checkbox checked={sel[kind].has(c.sku)} onCheckedChange={() => toggle(kind, c.sku)} aria-label={`Aplicar ${c.name}`} /></TableCell>
                          <TableCell className="tabular">{c.sku}</TableCell>
                          <TableCell className="whitespace-normal font-medium">{c.name}</TableCell>
                          <TableCell className="tabular text-right">{c.current_cents === null ? "—" : money(c.current_cents)}</TableCell>
                          <TableCell className="tabular text-right font-semibold">{money(c.new_cents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ),
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Vigência e aplicação</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  Custo/preço de produtos NOVOS valem desde
                  <Input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
                  <span className="text-xs text-muted-foreground">Use o início do mês em que o produto começou a ser vendido, para a margem desse mês resolver o custo.</span>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  MUDANÇAS em produtos existentes valem desde
                  <Input type="date" value={changeFrom} onChange={(e) => setChangeFrom(e.target.value)} />
                  <span className="text-xs text-muted-foreground">Padrão: hoje. Uma data no passado reprecifica a margem dos meses já fechados.</span>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={onApply} disabled={!canWrite || applying || total === 0}>
                  {applying ? "Aplicando…" : `Aplicar ${total} ${total === 1 ? "item" : "itens"}`}
                </Button>
                {!canWrite && <span className="text-xs text-muted-foreground">Sem permissão (products:write).</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Depois de cadastrar, reimporte as vendas e o abastecimento do mês em Ingestão: as linhas antes rejeitadas por produto sem cadastro só entram numa nova importação.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {results && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {results.map((r, n) => (
                <li key={`${r.sku}-${r.action}-${n}`} className={r.ok ? "" : "text-destructive"}>
                  <span className="tabular mr-2">{r.sku}</span>
                  {r.action === "create" ? "cadastro" : r.action === "cost" ? "custo" : "preço"}: {r.ok ? "ok" : r.error}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
