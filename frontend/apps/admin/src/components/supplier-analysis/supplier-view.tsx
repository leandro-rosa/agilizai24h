import { Card, CardContent } from "@/components/ui/card";
import type { CompareTo, CrossAnalysis, Figure, MovementWithComparison, SupplierAnalysis } from "@/lib/api/supplier-analysis";
import type { Product } from "@/lib/api/products";
import { SUPPLIER_CATEGORY_LABELS, type Supplier } from "@/lib/api/suppliers";
import { formatFigure } from "@/lib/supplier-analysis/format";
import { DataQualityNote } from "./data-quality-note";
import { EvolutionTable } from "./evolution-table";
import { InsightList } from "./insight-list";
import { KpiStrip, type Kpi } from "./kpi-strip";
import { LinkProductToSupplier } from "./link-supplier";
import { MovementBars } from "./movement-bars";
import { SupplierProductsTable } from "./supplier-products-table";

const NO_BASE_VARIATION = { reference: { available: false, reason: "no_base" }, change: { available: false, reason: "no_base" } } as const;

export function movementKpis(totals: MovementWithComparison, extras: { linkedProducts?: number } = {}): Kpi[] {
  const { current, comparison } = totals;
  const kpis: Kpi[] = [
    { label: "Valor comprado", figure: current.purchasedCents, kind: "cents", variation: comparison.purchasedCents, higherIsBetter: null },
    { label: "Unidades compradas", figure: current.purchasedUnits, kind: "units", variation: comparison.purchasedUnits, higherIsBetter: null },
  ];

  if (extras.linkedProducts !== undefined) {
    const linked: Figure = { available: true, value: extras.linkedProducts };
    kpis.push({ label: "Produtos vinculados", figure: linked, kind: "skus", variation: NO_BASE_VARIATION, higherIsBetter: null });
  }

  kpis.push(
    { label: "Unidades vendidas", figure: current.sold, kind: "units", variation: comparison.sold, higherIsBetter: true },
    {
      label: "Perdas",
      figure: current.lost,
      kind: "units",
      variation: comparison.lost,
      higherIsBetter: false,
      secondary: { figure: current.lossCents, kind: "cents" },
    },
    { label: "Margem", figure: current.marginShare, kind: "share", variation: comparison.marginShare, higherIsBetter: true },
  );

  return kpis;
}

function CrossCard({ cross, supplier }: { cross: CrossAnalysis; supplier: Supplier }) {
  return (
    <Card data-testid="cross-card">
      <CardContent className="flex flex-col gap-2 pt-4 text-sm">
        <p className="font-medium">
          {cross.product.name} × {supplier.name}
        </p>
        {!cross.linked ? (
          <p className="text-muted-foreground">
            {cross.product.declaredSupplierId === null
              ? "Este produto não tem fornecedor cadastrado, então não há movimentação a mostrar para este fornecedor."
              : "O fornecedor cadastrado deste produto é outro, então não há movimentação a mostrar para este fornecedor."}
          </p>
        ) : (
          cross.totals && (
            <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Abastecido</dt><dd>{formatFigure(cross.totals.current.restocked, "units")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Vendido</dt><dd>{formatFigure(cross.totals.current.sold, "units")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Perdido</dt><dd>{formatFigure(cross.totals.current.lost, "units")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Compras</dt><dd>{formatFigure(cross.totals.current.purchasedUnits, "units")}</dd></div>
            </dl>
          )
        )}
        <p className="text-xs text-muted-foreground">
          {cross.suppliersUnavailableReason === "no_purchase_history"
            ? "A comparação entre fornecedores do mesmo produto (quantidade, custo médio, compras, vendas geradas e perdas) depende do histórico de compras, ainda não registrado."
            : ""}
        </p>
      </CardContent>
    </Card>
  );
}

export function SupplierView({
  supplier,
  analysis,
  products,
  compareTo,
  cross,
  onSelectProduct,
}: {
  supplier: Supplier;
  analysis: SupplierAnalysis;
  products: Product[];
  compareTo: CompareTo;
  cross?: CrossAnalysis;
  onSelectProduct: (sku: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1 pt-4">
          <p className="text-lg font-semibold">{supplier.name}</p>
          <p className="text-sm text-muted-foreground">
            {supplier.tax_id ? `CNPJ ${supplier.tax_id} · ` : ""}Categoria: {SUPPLIER_CATEGORY_LABELS[supplier.category] ?? supplier.category}
          </p>
          <DataQualityNote meta={analysis.meta} />
        </CardContent>
      </Card>
      <KpiStrip items={movementKpis(analysis.totals, { linkedProducts: analysis.products.length })} compareTo={compareTo} />
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <InsightList title="Principais insights deste fornecedor" insights={analysis.insights} />
        <MovementBars movement={analysis.totals.current} />
      </div>
      {cross && <CrossCard cross={cross} supplier={supplier} />}
      <SupplierProductsTable lines={analysis.products} onSelect={onSelectProduct} />
      <EvolutionTable points={analysis.evolution} />
      <LinkProductToSupplier supplier={supplier} products={products} />
    </div>
  );
}
