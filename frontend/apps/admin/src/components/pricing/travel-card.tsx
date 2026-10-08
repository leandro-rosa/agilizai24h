import type { TravelEstimate } from "@/lib/api/pricing";
import { count, money, period as formatPeriod } from "@/lib/format";

const STATUS_TEXT: Record<string, string> = {
  used: "usado",
  no_cost: "sem DRE do mês",
  no_visits: "sem registro de abastecimentos",
  zero_visits: "zero abastecimentos",
};

/**
 * O custo médio ESTIMADO por abastecimento: o gasto de deslocamento do mês dividido pelos abastecimentos do mesmo mês, com o período e os valores usados.
 * É uma média, nunca o custo real de uma rota ou visita, e não é exclusiva do minimercado (a conta não separa a atividade). Fica fora do preço e entra
 * uma vez só, no resultado após rateio. Sem abastecimentos não há divisão nem custo zero.
 */
export function TravelCard({ travel }: { travel: TravelEstimate | null | undefined }) {
  if (!travel) return null;

  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Deslocamento: custo médio estimado por abastecimento{" "}
        <span className="tabular font-semibold">{travel.perVisitCents === null ? "indisponível" : money(Math.round(travel.perVisitCents))}</span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Gasto de deslocamento do mês ÷ abastecimentos realizados no mesmo mês ({travel.scope}). Unidade: {travel.unit}.
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Mês</th>
              <th className="py-1 pr-2 text-right font-normal">Gasto</th>
              <th className="py-1 pr-2 text-right font-normal">Abastecimentos</th>
              <th className="py-1 pr-2 text-right font-normal">Média</th>
              <th className="py-1 font-normal">Situação</th>
            </tr>
          </thead>
          <tbody>
            {travel.months.map((month) => (
              <tr key={month.period}>
                <td className="py-1 pr-2">{formatPeriod(month.period)}</td>
                <td className="tabular py-1 pr-2 text-right">{month.costCents === null ? "—" : money(month.costCents)}</td>
                <td className="tabular py-1 pr-2 text-right">{month.visits === null ? "—" : count(month.visits)}</td>
                <td className="tabular py-1 pr-2 text-right">{month.perVisitCents === null ? "—" : money(Math.round(month.perVisitCents))}</td>
                <td className="py-1">{STATUS_TEXT[month.status] ?? month.status}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-1 pr-2">Meses usados</td>
              <td className="tabular py-1 pr-2 text-right">{money(travel.usedCostCents)}</td>
              <td className="tabular py-1 pr-2 text-right">{count(travel.usedVisits)}</td>
              <td className="tabular py-1 pr-2 text-right">{travel.perVisitCents === null ? "—" : money(Math.round(travel.perVisitCents))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {travel.excludedMonths.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-warning">
            {travel.excludedMonths.map((month) => (
              <li key={month.period}>
                {formatPeriod(month.period)} fora da média: {month.reason}.
              </li>
            ))}
          </ul>
        )}
        {travel.stores.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Rateio estimado por loja (média × abastecimentos da loja)</summary>
            <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
              {travel.stores.map((store) => (
                <li key={store.storeId} className="flex justify-between gap-2">
                  <span>Loja {store.storeId} · {count(store.visits)} abastecimentos</span>
                  <span className="tabular">{money(Math.round(store.estimatedCents))}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {travel.limitations.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
