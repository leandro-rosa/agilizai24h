import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

/**
 * A tab whose analysis is deliberately not built yet. It says so and says why,
 * instead of showing an empty table that would read as "nothing found".
 */
export function HeldTab({ title, what, pointer = true }: { title: string; what: string; /** Whether to point at the Combos tab; false inside that tab itself. */ pointer?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          <StatusBadge>Em espera</StatusBadge>
        </CardTitle>
        <CardDescription>
          {what} Esta análise só começa depois que os meses reais forem importados pelo Drive, a qualidade do cupom e do histórico for conferida e os parâmetros forem calibrados —
          nenhuma regra foi congelada antes disso.
          {pointer && (
            <>
              {" "}
              Enquanto isso, a aba <strong>Combos &amp; Cross-sell</strong> mostra a medição da cobertura de cupom que essa calibração vai usar.
            </>
          )}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
