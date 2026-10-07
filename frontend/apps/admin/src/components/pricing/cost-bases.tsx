import { StatusBadge } from "@/components/status-badge";
import type { CostBasis, PricingProduct } from "@/lib/api/pricing";
import { date, money } from "@/lib/format";
import { percent, points } from "@/lib/pricing/labels";

const BASIS_TEXT: Record<CostBasis, string> = {
  received_purchase: "compra recebida e confirmada",
  registry_or_manual: "custo cadastral ou manual, sem compra recebida",
};

/**
 * Três custos que a tela nunca mistura: o histórico que o diagnóstico do período usou, o último custo de uma compra RECEBIDA (com ou sem nota) e o
 * custo cadastral ou manual em vigor hoje. Um custo manual nunca é rotulado como compra confirmada; pode ser a base quando não há compra, mas com a
 * origem e o aviso à vista. A cotação de reposição só existe no simulador, escolhida por quem simula.
 */
export function CostBasesSection({ product }: { product: PricingProduct }) {
  const bases = product.costBases;
  const atPurchase = product.atLastPurchaseCost ?? null;
  if (!bases) return null;

  return (
    <section aria-labelledby="cost-bases" className="flex flex-col gap-2">
      <h3 id="cost-bases" className="text-sm font-semibold">Qual custo é este?</h3>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Custo histórico (diagnóstico do período)</dt>
          <dd>
            {bases.historical ? (
              <>
                {money(bases.historical.costCents)} desde {date(bases.historical.effectiveFrom)} · {BASIS_TEXT[bases.historical.basis]}
                {bases.historical.basis === "registry_or_manual" && <span className="block text-xs text-warning">Custo informado sem compra recebida: não é uma compra confirmada.</span>}
              </>
            ) : (
              "Sem custo vigente no último dia do período"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Último custo de compra recebida e confirmada (com ou sem nota)</dt>
          <dd>
            {bases.lastPurchase ? (
              <>
                {money(bases.lastPurchase.costCents)}, recebida em {date(bases.lastPurchase.effectiveFrom)}
                {bases.lastPurchase.invoiceNumber ? ` · nota ${bases.lastPurchase.invoiceNumber}` : " · sem nota"}
              </>
            ) : (
              "Nenhuma compra recebida registrada"
            )}
          </dd>
        </div>
        {bases.registry && (
          <div>
            <dt className="text-xs text-muted-foreground">Custo cadastral ou correção manual em vigor hoje</dt>
            <dd>
              {money(bases.registry.costCents)} desde {date(bases.registry.effectiveFrom)} · origem: {bases.registry.source === "manual" ? "digitado à mão" : bases.registry.source}
              <span className="block text-xs text-warning">Não é uma compra confirmada: serve de base alternativa só quando não há compra recebida mais recente.</span>
            </dd>
          </div>
        )}
        {atPurchase && (
          <div className="rounded-lg border p-3">
            <dt className="flex items-center gap-2 text-xs text-muted-foreground">
              Sugestão atual, ao custo da última compra recebida <StatusBadge tone="neutral">hoje</StatusBadge>
            </dt>
            <dd>
              Custo {money(atPurchase.costCents)} (desde {date(atPurchase.effectiveFrom)}): margem de contribuição {percent(atPurchase.marginAtCurrentPrice)} ao preço atual
              {atPurchase.targetPriceCents !== null ? ` · preço-meta ${money(atPurchase.targetPriceCents)}` : " · meta não alcançável pela fórmula"}. O diagnóstico do período acima continua valorizado ao custo histórico.
            </dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        O custo vigente no fim do mês é a regra do CMV do financeiro: ele não garante o custo exato de cada venda do mês.
      </p>
    </section>
  );
}

/** Por que a margem de hoje não é a que o cálculo anterior mostrava: cada diferença numa linha, e o que não fecha aparece como "não explicado". */
export function ReconciliationSection({ product }: { product: PricingProduct }) {
  const rec = product.reconciliation;
  if (!rec) return null;

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Comparação com o cálculo anterior (margem econômica {percent(rec.oldMargin)} → contribuição {percent(rec.newMargin)})</summary>
      <ul className="mt-2 flex flex-col gap-1">
        {rec.lines.map((line) => (
          <li key={line.label} className="flex justify-between gap-3">
            <span>{line.label}</span>
            <span className="tabular shrink-0">{points(line.points)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 text-muted-foreground">
          <span>Não explicado</span>
          <span className="tabular shrink-0">{points(rec.unexplainedPoints)}</span>
        </li>
      </ul>
    </details>
  );
}
