"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { PendingGroup, PricingProduct } from "@/lib/api/pricing";
import { count } from "@/lib/format";

const SHOWN = 50;

/** Onde corrigir cada motivo: o custo e o preço moram no cadastro de produtos; o resto, nas regras ou nas taxas. */
function fixFor(group: PendingGroup, sku: string): { label: string; href: string } | null {
  const product = `/products?sku=${encodeURIComponent(sku)}`;
  if (group.code === "no_cost" || group.code === "stale_cost" || group.code === "unreliable_cost") return { label: "Corrigir custo", href: `${product}&tab=costs` };
  if (group.code === "no_price") return { label: "Definir preço", href: `${product}&tab=prices` };

  return null;
}

/**
 * Os produtos que a análise não alcançou, numa pendência compacta: o motivo (custo ausente, custo antigo, sem preço…) e o caminho para corrigir.
 * Um produto pode ter mais de um motivo, então os grupos podem se sobrepor. Nenhum desses produtos é tratado como margem zero.
 */
export function PendingProducts({ groups, products, onOpen }: { groups: PendingGroup[]; products: PricingProduct[]; onOpen: (sku: string) => void }) {
  const [open, setOpen] = useState<PendingGroup["code"] | null>(null);
  const byName = useMemo(() => new Map(products.map((product) => [product.sku, product.name ?? product.sku])), [products]);
  const active = groups.find((group) => group.code === open) ?? null;

  if (groups.length === 0) return null;

  return (
    <section aria-label="Produtos sem dados suficientes" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">Produtos sem dados suficientes para a análise</p>
      <div className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <Button key={group.code} type="button" size="sm" variant={open === group.code ? "default" : "outline"} aria-pressed={open === group.code} onClick={() => setOpen(open === group.code ? null : group.code)}>
            {group.label}: {count(group.skus.length)}
          </Button>
        ))}
      </div>
      {active && (
        <div className="flex flex-col gap-1">
          <ul className="max-h-64 divide-y overflow-auto rounded-md border" aria-label={active.label}>
            {active.skus.slice(0, SHOWN).map((sku) => {
              const fix = fixFor(active, sku);

              return (
                <li key={sku} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5">
                  <span>
                    {byName.get(sku) ?? sku} <span className="font-mono text-xs text-muted-foreground">{sku}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    {fix && (
                      <Link className="font-medium underline underline-offset-2" href={fix.href}>
                        {fix.label}
                      </Link>
                    )}
                    <button type="button" className="underline underline-offset-2" onClick={() => onOpen(sku)}>
                      Ver análise
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {active.skus.length > SHOWN && <p className="text-xs text-muted-foreground">Mostrando {SHOWN} de {count(active.skus.length)}. Use a busca e a situação “Dados insuficientes” para ver os outros.</p>}
          <p className="text-xs text-muted-foreground">Um produto pode ter mais de um motivo, por isso os grupos podem somar mais que o total.</p>
        </div>
      )}
    </section>
  );
}
