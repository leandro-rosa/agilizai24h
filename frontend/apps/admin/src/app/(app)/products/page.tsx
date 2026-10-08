"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { CategoriesView } from "@/components/products/categories-view";
import { ProductsWorkspace } from "@/components/products/products-workspace";
import { PricingScreen } from "@/components/pricing/pricing-screen";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/lib/auth/use-permission";

/**
 * Produtos: uma lista só, com cadastro, custo, preço e decisão de preço no mesmo lugar (`ProductsWorkspace`). As outras duas visões são secundárias e
 * voltam para a lista: "Analisar período" (os relatórios de precificação por período, inclusive os antigos) e "Categorias". `?view=` escolhe; `?sku=`
 * abre o painel de preço do produto e `?sku=&tab=` o cadastro completo. Links antigos continuam valendo: `?view=pricing&sku=` abre o produto na lista.
 */
function ProductsArea() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view");
  const canWrite = useHasPermission("products:write");
  const back = () => router.replace("/products", { scroll: false });
  const go = (target: string) => router.replace(`/products?view=${target}`, { scroll: false });

  if (view === "categories")
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="self-start" onClick={back}>
          <ArrowLeft aria-hidden /> Voltar aos produtos
        </Button>
        <CategoriesView canWrite={canWrite} />
      </div>
    );

  // O relatório por período. Um link antigo com `sku` quer o produto, não o relatório.
  if ((view === "period" || view === "pricing") && !params.get("sku"))
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="self-start" onClick={back}>
          <ArrowLeft aria-hidden /> Voltar aos produtos
        </Button>
        <PageHeader title="Analisar período" description="Os cálculos de precificação por período, como foram feitos. A decisão de preço de hoje está na lista de produtos." />
        <PricingScreen embedded />
      </div>
    );

  return <ProductsWorkspace onViewPeriod={() => go("period")} onCategories={() => go("categories")} />;
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsArea />
    </Suspense>
  );
}
