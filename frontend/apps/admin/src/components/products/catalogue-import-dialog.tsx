"use client";

import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApplyCatalogueImportMutation, usePreviewCatalogueImportMutation, type ImportApplied, type ImportPreview, type ImportRow, type ImportRowResult } from "@/lib/api/products";
import { IMPORT_FIELDS, TEMPLATE_EXAMPLE, TEMPLATE_HEADER, TEMPLATE_NOTES, buildRows, guessMapping, type FieldKey, type Mapping } from "@/lib/products/import-mapping";

const FIELD_NAME: Record<string, string> = {
  name: "nome", category: "categoria", subcategory: "subcategoria", brand: "marca", saleUnit: "unidade de venda", purchaseUnit: "unidade de compra", packageType: "tipo de embalagem", unitsPerPackage: "fator (un. por caixa)",
};
const ACTION_LABEL = { create: "Novo", update: "Atualiza", unchanged: "Sem mudança", conflict: "Conflito" } as const;
const ACTION_TONE = { create: "positive", update: "attention", unchanged: "neutral", conflict: "critical" } as const;
const SHOWN = 200;

type Step = "file" | "map" | "preview" | "done";

async function readTable(file: File): Promise<unknown[][]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];

  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
}

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const products = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER, TEMPLATE_EXAMPLE]);
  products["!cols"] = TEMPLATE_HEADER.map((name) => ({ wch: Math.max(14, name.length + 2) }));
  XLSX.utils.book_append_sheet(workbook, products, "Produtos");
  const notes = XLSX.utils.aoa_to_sheet(TEMPLATE_NOTES);
  notes["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, notes, "Instruções");
  XLSX.writeFile(workbook, "Modelo-importacao-produtos.xlsx");
}

/**
 * Importa o catálogo de uma planilha Excel: modelo para baixar, mapeamento de colunas, prévia (novos, atualizações, sem mudança e conflitos) e só então a
 * aplicação. SKU é a chave. Célula vazia nunca apaga o que já existe, a não ser que a pessoa peça (e veja o que seria limpo); nada é excluído.
 */
export function CatalogueImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [preview, { isLoading: previewing }] = usePreviewCatalogueImportMutation();
  const [apply, { isLoading: applying }] = useApplyCatalogueImportMutation();
  const [step, setStep] = useState<Step>("file");
  const [table, setTable] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [clearEmpty, setClearEmpty] = useState(false);
  const [result, setResult] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState<ImportApplied | null>(null);

  const headers = (table[0] ?? []).map((header, index) => String(header ?? "").trim() || `Coluna ${index + 1}`);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const read = await readTable(file);
      if (read.length < 2) return void toast.error("A planilha precisa de uma linha de cabeçalho e ao menos um produto.");
      setTable(read);
      setMapping(guessMapping(read[0]));
      setStep("map");
    } catch (error) {
      console.error("Ler planilha falhou", error);
      toast.error("Não foi possível ler a planilha. Use um arquivo .xlsx ou .csv.");
    }
  }

  async function runPreview(nextClear: boolean) {
    if (!mapping) return;
    const built = buildRows(table, mapping);
    if (built.length === 0) return void toast.error("Nenhuma linha com dados nas colunas escolhidas.");
    try {
      setRows(built);
      setClearEmpty(nextClear);
      setResult(await preview({ rows: built, clearEmpty: nextClear }).unwrap());
      setStep("preview");
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível montar a prévia.");
    }
  }

  async function confirm() {
    try {
      const done = await apply({ rows, clearEmpty }).unwrap();
      setApplied(done);
      setStep("done");
      const failed = done.results.filter((r) => !r.ok && r.action !== "conflict").length;
      toast[failed > 0 ? "warning" : "success"](failed > 0 ? `Importação concluída, mas ${failed} ${failed === 1 ? "linha falhou" : "linhas falharam"}.` : "Importação concluída.");
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível aplicar a importação.");
    }
  }

  const skuMissing = mapping !== null && mapping.sku < 0;
  const writable = result ? result.summary.create + result.summary.update : 0;
  const shown = result ? result.rows.filter((r) => r.action !== "unchanged").slice(0, SHOWN) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar catálogo do Excel</DialogTitle>
          <DialogDescription>O SKU é a chave. Você confere o que seria criado, atualizado ou barrado antes de aplicar; nada é excluído.</DialogDescription>
        </DialogHeader>

        {step === "file" && (
          <div className="flex flex-col gap-3">
            <Input type="file" accept=".xlsx,.xls,.csv" aria-label="Arquivo da planilha" onChange={(e) => onFile(e.target.files?.[0])} />
            <div>
              <Button variant="outline" size="sm" onClick={() => void downloadTemplate()}>
                Baixar modelo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Custos e preços não entram nesta importação: o custo nasce das compras e o preço é aprovado na Precificação.</p>
          </div>
        )}

        {step === "map" && mapping && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Diga qual coluna da planilha é cada campo. Reconhecemos o que deu; confira. Colunas não escolhidas ficam de fora.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {field.label}
                  {field.required ? " (obrigatório)" : ""}
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                    aria-label={`Coluna de ${field.label}`}
                    value={mapping[field.key]}
                    onChange={(e) => setMapping({ ...mapping, [field.key as FieldKey]: Number(e.target.value) })}
                  >
                    <option value={-1}>— não importar —</option>
                    {headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {skuMissing && <p className="text-sm text-destructive">Escolha a coluna do SKU: sem ele não há como saber qual produto a linha é.</p>}
          </div>
        )}

        {step === "preview" && result && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-sm" data-testid="summary">
              <StatusBadge tone="positive">{result.summary.create} novos</StatusBadge>
              <StatusBadge tone="attention">{result.summary.update} atualizações</StatusBadge>
              <StatusBadge tone="neutral">{result.summary.unchanged} sem mudança</StatusBadge>
              <StatusBadge tone="critical">{result.summary.conflict} conflitos (não serão aplicados)</StatusBadge>
            </div>

            <label className="flex items-start gap-1.5 text-sm">
              <input type="checkbox" checked={clearEmpty} disabled={previewing} onChange={(e) => void runPreview(e.target.checked)} />
              <span>
                Apagar o dado do produto quando a célula estiver vazia
                <span className="block text-xs text-muted-foreground">Desligado (padrão): célula vazia nunca apaga nada. Ligado, a prévia lista exatamente o que seria limpo.</span>
              </span>
            </label>

            <div className="max-h-96 min-w-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>O que acontece</TableHead>
                    <TableHead>Detalhe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((item) => (
                    <PreviewRow key={item.row} item={item} />
                  ))}
                </TableBody>
              </Table>
              {result.rows.filter((r) => r.action !== "unchanged").length > SHOWN && <p className="p-2 text-xs text-muted-foreground">Mostrando as primeiras {SHOWN} linhas com mudança ou conflito.</p>}
            </div>
            {result.summary.conflict > 0 && <p className="text-sm text-warning">Linhas em conflito ficam de fora: corrija na planilha e importe de novo (o que já foi aplicado não duplica).</p>}
          </div>
        )}

        {step === "done" && applied && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Importação concluída: <strong>{applied.results.filter((r) => r.ok && r.action === "create").length}</strong> criados, <strong>{applied.results.filter((r) => r.ok && r.action === "update").length}</strong> atualizados,{" "}
              {applied.summary.unchanged} sem mudança, {applied.summary.conflict} não aplicados por conflito.
            </p>
            {applied.results.filter((r) => !r.ok).length > 0 && (
              <ul className="list-disc pl-5 text-xs text-destructive">
                {applied.results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <li key={r.row}>
                      Linha {r.row} ({r.sku ?? "sem SKU"}): {r.error}
                    </li>
                  ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Importar o mesmo arquivo de novo não duplica nada: as linhas já aplicadas aparecem como “sem mudança”.</p>
          </div>
        )}

        <DialogFooter>
          {step === "map" && (
            <>
              <Button variant="outline" onClick={() => setStep("file")}>
                Voltar
              </Button>
              <Button onClick={() => void runPreview(false)} disabled={skuMissing || previewing}>
                {previewing ? "Montando a prévia…" : "Ver prévia"}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("map")} disabled={applying}>
                Voltar
              </Button>
              <Button onClick={confirm} disabled={applying || writable === 0}>
                {applying ? "Aplicando…" : `Aplicar ${writable} ${writable === 1 ? "alteração" : "alterações"}`}
              </Button>
            </>
          )}
          {(step === "file" || step === "done") && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ item }: { item: ImportRowResult }) {
  return (
    <TableRow>
      <TableCell className="tabular">{item.row}</TableCell>
      <TableCell className="font-mono text-xs">{item.sku ?? "—"}</TableCell>
      <TableCell>
        <StatusBadge tone={ACTION_TONE[item.action]}>{ACTION_LABEL[item.action]}</StatusBadge>
      </TableCell>
      <TableCell className="whitespace-normal text-xs">
        {item.problems.map((problem) => (
          <p key={problem} className="text-destructive">
            {problem}
          </p>
        ))}
        {item.action !== "conflict" &&
          item.changes.map((change) => (
            <p key={change.field}>
              {FIELD_NAME[change.field] ?? change.field}: {change.from === null ? "—" : String(change.from)} → <strong>{String(change.to)}</strong>
            </p>
          ))}
        {item.addEan && <p>Vincula o EAN {item.addEan}</p>}
        {item.clears.length > 0 && <p className="text-warning">Vai limpar: {item.clears.map((field) => FIELD_NAME[field] ?? field).join(", ")}</p>}
      </TableCell>
    </TableRow>
  );
}
