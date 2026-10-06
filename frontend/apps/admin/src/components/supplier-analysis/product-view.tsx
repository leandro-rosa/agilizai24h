import { Card, CardContent } from "@/components/ui/card";
import type { CompareTo, ProductAnalysis } from "@/lib/api/supplier-analysis";
import type { Product } from "@/lib/api/products";
import type { Supplier } from "@/lib/api/suppliers";
import { DataQualityNote } from "./data-quality-note";
import { EvolutionTable } from "./evolution-table";
import { InsightList } from "./insight-list";
import { KpiStrip, type Kpi } from "./kpi-strip";
import { LinkSupplierToProduct } from "./link-supplier";
import { MovementBars } from "./movement-bars";
import { ProfitabilityStrip } from "./profitability-strip";
import { StorePerformanceTable } from "./store-performance-table";

function productKpis(analysis: ProductAnalysis): Kpi[] {
  const { current, comparison } = analysis.totals;

  return [
    { label: "Quantidade comprada", figure: current.purchasedUnits, kind: "units", variation: comparison.purchasedUnits, higherIsBetter: null },
    { label: "Valor comprado", figure: current.purchasedCents, kind: "cents", variation: comparison.purchasedCents, higherIsBetter: null },
    { label: "Abastecido", figure: current.restocked, kind: "units", variation: comparison.restocked, higherIsBetter: null },
    { label: "Vendido", figure: current.sold, kind: "units", variation: comparison.sold, higherIsBetter: true },
    { label: "Perdido", figure: current.lost, kind: "units", variation: comparison.lost, higherIsBetter: false },
    { label: "Valor das perdas", figure: current.lossCents, kind: "cents", variation: comparison.lossCents, higherIsBetter: false },
    { label: "Receita gerada", figure: current.revenueCents, kind: "cents", variation: comparison.revenueCents, higherIsBetter: true },
    { label: "Custo médio", figure: current.avgCostCents, kind: "cents", variation: comparison.avgCostCents, higherIsBetter: false },
  ];
}

export function ProductView({
  product,
  analysis,
  supplier,
  suppliers,
  compareTo,
}: {
  product: Product;
  analysis: ProductAnalysis;
  supplier: Supplier | undefined;
  suppliers: Supplier[];
  compareTo: CompareTo;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1 pt-4">
          <p className="text-lg font-semibold">{analysis.product.name}</p>
          <p className="text-sm text-muted-foreground">
            SKU {analysis.product.sku} · Fornecedor atual: {supplier ? supplier.name : "sem fornecedor cadastrado"}
          </p>
          <p className="text-xs text-muted-foreground">
            Histórico de fornecedores, quantidade e valor por fornecedor dependem do histórico de compras, ainda não registrado.
          </p>
          <DataQualityNote meta={analysis.meta} />
        </CardContent>
      </Card>
      <KpiStrip items={productKpis(analysis)} compareTo={compareTo} columns={4} comparisonLabel={analysis.meta.comparisonLabel} />
      <ProfitabilityStrip totals={analysis.totals} compareTo={compareTo} comparisonLabel={analysis.meta.comparisonLabel} />
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <InsightList title="Principais insights deste produto" insights={analysis.insights} />
        <MovementBars movement={analysis.totals.current} />
      </div>
      <StorePerformanceTable stores={analysis.stores} minRestockedNote />
      <EvolutionTable points={analysis.evolution} />
      {!supplier && <LinkSupplierToProduct product={product} suppliers={suppliers} />}
    </div>
  );
}
