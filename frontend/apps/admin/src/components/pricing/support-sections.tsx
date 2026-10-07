import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CategorySummary } from "@/lib/api/pricing";
import { money } from "@/lib/format";
import { percent, points, signedPercent } from "@/lib/pricing/labels";
import type { CostChange, Opportunity } from "@/lib/pricing/view";

const EMPTY = "Nada a mostrar neste recorte.";

export function OpportunitiesSection({ items, onOpen }: { items: Opportunity[]; onOpen: (sku: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Principais oportunidades de precificação</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{EMPTY}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map(({ product, text }, index) => (
              <li key={product.sku} className="flex gap-3">
                <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{index + 1}</span>
                <div className="flex flex-col gap-0.5 text-sm">
                  <button type="button" onClick={() => onOpen(product.sku)} className="w-fit text-left font-medium underline-offset-2 hover:underline">
                    {product.name ?? product.sku}
                  </button>
                  <span className="text-muted-foreground">{text}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function CostChangesSection({ items, onOpen }: { items: CostChange[]; onOpen: (sku: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custos que mais mudaram</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{EMPTY}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Produto</th>
                  <th className="pb-2 text-right font-medium">Custo anterior</th>
                  <th className="pb-2 text-right font-medium">Custo atual</th>
                  <th className="pb-2 text-right font-medium">Variação</th>
                  <th className="pb-2 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.product.sku} className="border-t">
                    <td className="py-2">
                      <button type="button" onClick={() => onOpen(row.product.sku)} className="text-left underline-offset-2 hover:underline">
                        {row.product.name ?? row.product.sku}
                      </button>
                    </td>
                    <td className="tabular py-2 text-right">{money(row.previousCostCents)}</td>
                    <td className="tabular py-2 text-right">{money(row.currentCostCents)}</td>
                    <td className={`tabular py-2 text-right ${row.variation > 0 ? "text-destructive" : "text-success"}`}>{signedPercent(row.variation)}</td>
                    <td className="tabular py-2 text-right">{points(row.marginChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A margem por categoria é do escopo inteiro (o backend não manda a receita por produto): só o filtro de categoria a recorta. */
export function CategoriesSection({ items }: { items: CategorySummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Margem por categoria</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{EMPTY}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Categoria</th>
                  <th className="pb-2 text-right font-medium">Margem média</th>
                  <th className="pb-2 text-right font-medium">Meta</th>
                  <th className="pb-2 text-right font-medium">Diferença</th>
                  <th className="pb-2 text-right font-medium">Faturamento</th>
                  <th className="pb-2 text-right font-medium">Vendas</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.category} className="border-t">
                    <td className="py-2">{row.category}</td>
                    <td className="tabular py-2 text-right">{percent(row.averageMargin)}</td>
                    <td className="tabular py-2 text-right">{percent(row.targetMargin, 0)}</td>
                    <td className="tabular py-2 text-right">
                      {row.difference === null ? (
                        "—"
                      ) : (
                        <StatusBadge tone={row.difference >= 0 ? "positive" : "attention"}>{points(row.difference)}</StatusBadge>
                      )}
                    </td>
                    <td className="tabular py-2 text-right">{money(row.revenueCents)}</td>
                    <td className="tabular py-2 text-right">{percent(row.revenueShare, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
