"use client";

import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { CatalogueView } from "@/components/products/catalogue-view";
import { CategoriesView } from "@/components/products/categories-view";
import { NewProductDialog } from "@/components/products/new-product-dialog";
import { PricingScreen } from "@/components/pricing/pricing-screen";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/lib/auth/use-permission";

const VIEWS = [
  { key: "catalog", label: "Catálogo" },
  { key: "pricing", label: "Precificação" },
  { key: "categories", label: "Categorias" },
] as const;

type View = (typeof VIEWS)[number]["key"];

/**
 * Produtos e Precificação: uma área só, sobre o mesmo cadastro e o mesmo identificador de produto. Catálogo (todos os produtos, inclusive os novos e os sem
 * preço), Precificação (análise, simulação e aprovação) e Categorias (a lista única de categorias e subcategorias). `?view=` escolhe a aba; `sku` e `tab`
 * continuam significando o produto aberto no catálogo.
 */
function ProductsAndPricing() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("view");
  const view: View = VIEWS.some((v) => v.key === requested) ? (requested as View) : "catalog";
  const canWrite = useHasPermission("products:write");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Produtos e Precificação"
        description="Cadastro e decisão de preço no mesmo lugar: o mesmo produto em Compras, Estoque, Vendas, Abastecimento e Precificação."
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Novo produto
            </Button>
          ) : null
        }
      />

      <div role="tablist" aria-label="Produtos e Precificação" className="flex flex-wrap gap-2 border-b pb-3">
        {VIEWS.map((item) => (
          <Button key={item.key} role="tab" aria-selected={view === item.key} size="sm" variant={view === item.key ? "default" : "outline"} onClick={() => router.replace(item.key === "catalog" ? "/products" : `/products?view=${item.key}`, { scroll: false })}>
            {item.label}
          </Button>
        ))}
      </div>

      {view === "catalog" && <CatalogueView canWrite={canWrite} importing={importing} onImportingChange={setImporting} />}
      {view === "pricing" && <PricingScreen embedded />}
      {view === "categories" && <CategoriesView canWrite={canWrite} />}

      {creating && <NewProductDialog open onOpenChange={setCreating} onCreated={() => undefined} />}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsAndPricing />
    </Suspense>
  );
}
