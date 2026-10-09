import type { IncreaseCap, PricingProduct } from "@/lib/api/pricing";
import { money } from "@/lib/format";
import { percent } from "@/lib/pricing/labels";

/** O limite máximo de aumento parou o preço antes da meta: mostra o preço limitado, a margem que ele dá e a frase combinada. Nada fica implícito. */
export function IncreaseCapNotice({ cap }: { cap: IncreaseCap }) {
  return (
    <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="increase-cap">
      <p className="font-medium">{cap.message}</p>
      <p className="text-muted-foreground">
        O preço que atinge a meta de {percent(cap.targetMargin, 0)} seria {money(cap.targetPriceCents)}; o limite de aumento de {percent(cap.maxIncreaseBps / 10_000, 0)} permite no máximo {money(cap.ceilingCents)}. O preço limitado é{" "}
        <strong>{money(cap.limitedPriceCents)}</strong>, com margem de contribuição de <strong>{percent(cap.resultingMargin)}</strong>.
      </p>
    </div>
  );
}

/** Despesa relevante da DRE sem classe: o cálculo aparece, mas marcado "Precificação não validada", com exatamente o que falta. */
export function ValidationNotice({ product }: { product: Pick<PricingProduct, "validated" | "validationNotes" | "status"> }) {
  if (product.validated !== false || product.status === "insufficient_data") return null;
  const notes = product.validationNotes ?? [];

  return (
    <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="validation-notice">
      <p className="font-medium">Precificação não validada</p>
      {notes.length > 0 ? (
        <ul className="list-disc pl-5 text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note.replace(/^Precificação não validada:\s*/, "")}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Há despesas da DRE sem classificação; classifique-as em Regras de negócio.</p>
      )}
    </div>
  );
}
