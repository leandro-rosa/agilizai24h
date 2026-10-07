"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useApplyClassificationMutation,
  useCreateCategoryMutation,
  useCreateSubcategoryMutation,
  useGetCategoriesQuery,
  useGetClassificationReviewQuery,
  useUpdateCategoryMutation,
  useUpdateSubcategoryMutation,
  type CategoryRow,
  type SubcategoryRow,
} from "@/lib/api/products";
import { keywordsToText, textToKeywords } from "@/lib/products/taxonomy";

const messageOf = (failure: unknown, fallback: string) => (failure as { data?: { message?: string } })?.data?.message ?? fallback;

/**
 * Manutenção das categorias e subcategorias: a lista única que os formulários, filtros, importação, notas e a precificação usam. Nada é excluído:
 * uma categoria em uso é inativada (deixa de ser oferecida e os produtos e o histórico seguem como estão). Palavras-chave e sinônimos alimentam a classificação pelo nome.
 */
export function CategoriesView({ canWrite }: { canWrite: boolean }) {
  const { data: categories, isLoading, isError } = useGetCategoriesQuery();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: "category"; row: CategoryRow | null } | { kind: "subcategory"; category: CategoryRow; row: SubcategoryRow | null } | null>(null);
  const [updateCategory] = useUpdateCategoryMutation();
  const [updateSubcategory] = useUpdateSubcategoryMutation();

  const selected = useMemo(() => categories?.find((row) => row.key === selectedKey) ?? categories?.[0] ?? null, [categories, selectedKey]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando categorias…</p>;
  if (isError || !categories) return <p className="text-sm text-destructive">Não foi possível carregar as categorias.</p>;

  async function toggle(call: () => Promise<unknown>, done: string) {
    try {
      await call();
      toast.success(done);
    } catch (failure) {
      toast.error(messageOf(failure, "Não foi possível alterar."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Esta é a única lista de categorias do sistema: formulários, filtros, importação, notas e Precificação a usam. Categoria não se exclui: se está em uso, inative — os produtos e o histórico ficam como estão.
        </p>
        {canWrite && (
          <Button size="sm" onClick={() => setEditing({ kind: "category", row: null })}>
            + Nova categoria
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <ul className="flex flex-col gap-1" aria-label="Categorias">
          {categories.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                aria-pressed={selected?.id === row.id}
                onClick={() => setSelectedKey(row.key)}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${selected?.id === row.id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
              >
                <span>
                  <span className="font-medium">{row.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.products} {row.products === 1 ? "produto" : "produtos"} · {row.subcategories.length} {row.subcategories.length === 1 ? "subcategoria" : "subcategorias"}
                  </span>
                </span>
                {row.status === "inactive" && <StatusBadge tone="neutral">Inativa</StatusBadge>}
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <section aria-label={`Categoria ${selected.name}`} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">{selected.name}</h3>
                <p className="text-xs text-muted-foreground">
                  Chave <span className="font-mono">{selected.key}</span> · {selected.products} {selected.products === 1 ? "produto vinculado" : "produtos vinculados"}
                </p>
                <p className="text-xs text-muted-foreground">Palavras-chave: {selected.keywords.length > 0 ? keywordsToText(selected.keywords) : "nenhuma"}</p>
              </div>
              {canWrite && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "category", row: selected })}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggle(() => updateCategory({ id: selected.id, changes: { status: selected.status === "active" ? "inactive" : "active" } }).unwrap(), selected.status === "active" ? `${selected.name} inativada: os produtos continuam com ela.` : `${selected.name} reativada.`)}
                  >
                    {selected.status === "active" ? "Inativar" : "Reativar"}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Subcategorias de {selected.name}</h4>
              {canWrite && selected.status === "active" && (
                <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "subcategory", category: selected, row: null })}>
                  + Subcategoria
                </Button>
              )}
            </div>
            {selected.subcategories.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Esta categoria ainda não tem subcategorias.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subcategoria</TableHead>
                    <TableHead>Palavras-chave</TableHead>
                    <TableHead className="text-right">Produtos</TableHead>
                    <TableHead>Situação</TableHead>
                    {canWrite && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.subcategories.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium">{sub.name}</TableCell>
                      <TableCell className="whitespace-normal text-xs text-muted-foreground">{sub.keywords.length > 0 ? keywordsToText(sub.keywords) : "—"}</TableCell>
                      <TableCell className="tabular text-right">{sub.products}</TableCell>
                      <TableCell>{sub.status === "active" ? "Ativa" : "Inativa"}</TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: "subcategory", category: selected, row: sub })}>
                            Editar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggle(() => updateSubcategory({ id: sub.id, changes: { status: sub.status === "active" ? "inactive" : "active" } }).unwrap(), sub.status === "active" ? `${sub.name} inativada.` : `${sub.name} reativada.`)}>
                            {sub.status === "active" ? "Inativar" : "Reativar"}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        )}
      </div>

      <ReviewPanel canWrite={canWrite} />

      {editing?.kind === "category" && <CategoryDialog row={editing.row} onClose={() => setEditing(null)} />}
      {editing?.kind === "subcategory" && <SubcategoryDialog category={editing.category} row={editing.row} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CategoryDialog({ row, onClose }: { row: CategoryRow | null; onClose: () => void }) {
  const [create, { isLoading: creating }] = useCreateCategoryMutation();
  const [update, { isLoading: updating }] = useUpdateCategoryMutation();
  const [name, setName] = useState(row?.name ?? "");
  const [keywords, setKeywords] = useState(keywordsToText(row?.keywords ?? []));

  async function save() {
    try {
      if (row) await update({ id: row.id, changes: { name: name.trim(), keywords: textToKeywords(keywords) } }).unwrap();
      else await create({ name: name.trim(), keywords: textToKeywords(keywords) }).unwrap();
      toast.success(row ? "Categoria atualizada." : `Categoria ${name.trim()} criada.`);
      onClose();
    } catch (failure) {
      toast.error(messageOf(failure, "Não foi possível salvar a categoria."));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? `Editar ${row.name}` : "Nova categoria"}</DialogTitle>
          <DialogDescription>O nome não pode repetir o de outra categoria. A chave interna não muda ao renomear.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Nome
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da categoria" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Palavras-chave e sinônimos (separados por vírgula)
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} aria-label="Palavras-chave da categoria" placeholder="Ex.: suco, bebida, refresco" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!name.trim() || creating || updating}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubcategoryDialog({ category, row, onClose }: { category: CategoryRow; row: SubcategoryRow | null; onClose: () => void }) {
  const [create, { isLoading: creating }] = useCreateSubcategoryMutation();
  const [update, { isLoading: updating }] = useUpdateSubcategoryMutation();
  const [name, setName] = useState(row?.name ?? "");
  const [keywords, setKeywords] = useState(keywordsToText(row?.keywords ?? []));

  async function save() {
    try {
      if (row) await update({ id: row.id, changes: { name: name.trim(), keywords: textToKeywords(keywords) } }).unwrap();
      else await create({ categoryId: category.id, name: name.trim(), keywords: textToKeywords(keywords) }).unwrap();
      toast.success(row ? "Subcategoria atualizada." : `Subcategoria ${name.trim()} criada em ${category.name}.`);
      onClose();
    } catch (failure) {
      toast.error(messageOf(failure, "Não foi possível salvar a subcategoria."));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? `Editar ${row.name}` : `Nova subcategoria de ${category.name}`}</DialogTitle>
          <DialogDescription>{row ? "Renomear também renomeia nos produtos que a usam." : "O nome não pode repetir o de outra subcategoria desta categoria."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Nome
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da subcategoria" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Palavras-chave e sinônimos (separados por vírgula)
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} aria-label="Palavras-chave da subcategoria" placeholder="Ex.: monster, energy, red bull" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!name.trim() || creating || updating}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Propostas de classificação para os produtos sem subcategoria ou sem classificação confirmada: nada muda até a pessoa marcar e aplicar. */
function ReviewPanel({ canWrite }: { canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const review = useGetClassificationReviewQuery(undefined, { skip: !open });
  const [apply, { isLoading }] = useApplyClassificationMutation();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const items = review.data ?? [];

  async function applyPicked() {
    const chosen = items.filter((item) => picked.has(item.sku)).map((item) => ({ sku: item.sku, category: item.proposed.category, subcategory: item.proposed.subcategory }));
    try {
      const result = await apply({ items: chosen }).unwrap();
      const failed = result.results.filter((r) => !r.ok);
      toast[failed.length > 0 ? "warning" : "success"](`${result.applied} ${result.applied === 1 ? "produto classificado" : "produtos classificados"}${failed.length > 0 ? `; ${failed.length} não aplicados (${failed[0].error})` : ""}.`);
      setPicked(new Set());
    } catch (failure) {
      toast.error(messageOf(failure, "Não foi possível aplicar."));
    }
  }

  return (
    <section aria-label="Sugestões de classificação" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Sugestões para revisar</h3>
          <p className="text-xs text-muted-foreground">O sistema propõe uma categoria e subcategoria para os produtos que ainda não têm subcategoria ou cuja classificação ninguém confirmou. Nada muda até você marcar e aplicar.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          {open ? "Ocultar" : "Ver sugestões"}
        </Button>
      </div>

      {open && review.isLoading && <p className="text-sm text-muted-foreground">Procurando sugestões…</p>}
      {open && !review.isLoading && items.length === 0 && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Nenhuma sugestão: os produtos classificáveis já estão classificados, ou o nome não casa com as palavras-chave.</p>}
      {open && items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {canWrite && <TableHead className="w-8" />}
                <TableHead>Produto</TableHead>
                <TableHead>Hoje</TableHead>
                <TableHead>Sugestão</TableHead>
                <TableHead>Palavras que casaram</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.sku}>
                  {canWrite && (
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Aplicar a sugestão para ${item.name}`}
                        checked={picked.has(item.sku)}
                        onChange={(e) =>
                          setPicked((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(item.sku);
                            else next.delete(item.sku);

                            return next;
                          })
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="whitespace-normal">
                    {item.name}
                    <span className="block font-mono text-xs text-muted-foreground">{item.sku}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs">
                    {item.current.category}
                    {item.current.subcategory ? ` > ${item.current.subcategory}` : " (sem subcategoria)"}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs font-medium">
                    {item.proposed.categoryName}
                    {item.proposed.subcategory ? ` > ${item.proposed.subcategory}` : ""}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">{item.matched.join(", ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {canWrite && (
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={applyPicked} disabled={picked.size === 0 || isLoading}>
                Aplicar {picked.size} {picked.size === 1 ? "selecionada" : "selecionadas"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(items.map((item) => item.sku)))}>
                Selecionar todas
              </Button>
              <span className="text-xs text-muted-foreground">Os produtos aplicados passam a ter a classificação confirmada.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
