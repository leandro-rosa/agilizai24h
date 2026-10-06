import { FlaskConical } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { count, period as fmtPeriod } from "@/lib/format";
import { SIGNAL_LABELS, TESTS, type TestRow, type TestSignal, type TestsSummary } from "@/lib/overview/tests";
import { Block, moneyRound, pctText, Unavailable } from "./shared";

const tone: Record<TestSignal, "positive" | "attention" | "neutral"> = { positivo: "positive", atencao: "attention", mais_dados: "neutral" };

function Row({ r }: { r: TestRow }) {
  return (
    <TableRow>
      <TableCell className="min-w-56 whitespace-normal font-medium">
        {r.name}
        <p className="text-[11px] font-normal text-muted-foreground">{r.reasons.join(" · ")}</p>
      </TableCell>
      <TableCell className="tabular text-right">{r.storesSold}/{r.storesRestocked}</TableCell>
      <TableCell className="tabular text-right">{count(r.unitsSold)}</TableCell>
      <TableCell className="tabular text-right">{r.lossCents === null ? "—" : moneyRound(r.lossCents)}</TableCell>
      <TableCell className="tabular text-right">{pctText(r.marginPct, 0)}</TableCell>
      <TableCell className="whitespace-normal text-right text-xs">
        {r.monthsInTest} {r.monthsInTest === 1 ? "mês" : "meses"}
        <p className="text-muted-foreground">desde {fmtPeriod(r.firstPeriod)}</p>
      </TableCell>
      <TableCell><StatusBadge tone={tone[r.signal]}>{SIGNAL_LABELS[r.signal]}</StatusBadge></TableCell>
    </TableRow>
  );
}

/**
 * Não existe cadastro de produto em teste: a lista é DERIVADA do abastecimento
 * (mês do primeiro abastecimento do SKU na rede, em poucas lojas). O sinal é
 * evidência com os fatos ao lado — nunca aprovado/reprovado.
 */
export function TestsCard({ tests, loading, unavailable }: { tests: TestsSummary | null; loading: boolean; unavailable: boolean }) {
  return (
    <Block title="Produtos em teste" icon={<FlaskConical className="size-4 text-primary" />} href="/supply" linkLabel="Ver abastecimento" className="min-w-0">
      {loading && !tests ? (
        <p className="text-sm text-muted-foreground">Carregando abastecimento de todas as lojas…</p>
      ) : !tests || unavailable ? (
        <Unavailable what="abastecimento" />
      ) : tests.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum SKU com primeiro abastecimento nos últimos {TESTS.WINDOW_MONTHS} meses em até {TESTS.MAX_STORES} lojas
          {tests.historyStart ? ` (histórico de abastecimento importado desde ${fmtPeriod(tests.historyStart)})` : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right" title="Lojas que venderam / lojas abastecidas">Lojas</TableHead>
                <TableHead className="text-right">Unid. vendidas</TableHead>
                <TableHead className="text-right">Perdas</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Tempo de teste</TableHead>
                <TableHead>Sinal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{tests.rows.map((r) => <Row key={r.sku} r={r} />)}</TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Candidato = primeiro abastecimento na rede nos últimos {TESTS.WINDOW_MONTHS} meses, depois do início do histórico importado, em até {TESTS.MAX_STORES} lojas
        (regra provisória). O sistema guarda só o mês do abastecimento, não a data da visita. Se o código de barras mudou, confirme a troca abaixo para o produto deixar de aparecer como novo.
        Sinal é evidência, não decisão.
      </p>
    </Block>
  );
}
