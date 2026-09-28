"use client";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Level } from "@/lib/commercial-intelligence/types";
import type { Confidence } from "@/lib/loss-intelligence/types";
import type { RestockDisplayRow } from "./restock-table";

const CONFIDENCE_TO_LEVEL: Record<Confidence, Level> = { alta: "high", media: "medium", baixa: "low", insuficiente: "insufficient" };

const TREND_LABEL: Record<string, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };
const ESCOPO_LABEL: Record<string, string> = { local: "Local", multiplas_lojas: "Múltiplas lojas", rede: "Rede", indeterminado: "Indeterminado" };
const LOSS_ACTION_LABEL: Record<string, string> = {
  manter: "Manter", manter_monitorar: "Manter e monitorar", reduzir_abastecimento: "Reduzir abastecimento", investigar: "Investigar",
  suspender_abastecimento: "Suspender abastecimento", avaliar_retirada_loja: "Avaliar retirada (loja)", avaliar_retirada_rede: "Avaliar retirada (rede)",
  avaliar_permanencia_loja: "Avaliar permanência (loja)", avaliar_permanencia_rede: "Avaliar permanência (rede)", dados_insuficientes: "Dados insuficientes",
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RestockDrawer({ row, open, onOpenChange }: { row: RestockDisplayRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {row.productLabel} — {row.storeName}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">{row.kind === "recomendacao" ? <RecommendationBody data={row.data} /> : <OpportunityBody data={row.data} />}</div>
      </SheetContent>
    </Sheet>
  );
}

function RecommendationBody({ data }: { data: Extract<RestockDisplayRow, { kind: "recomendacao" }>["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Ação recomendada</h3>
        <p className="text-sm">Sugestão: {data.quantidadeSugeridaIA} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Por que?</h3>
        <p className="text-sm">{data.motivo}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Parametrização atual</h3>
        {data.parametrizacao ? (
          <div className="text-sm text-muted-foreground">
            <p>Nível de par: {data.parametrizacao.nivelDePar ?? "—"}</p>
            <p>Mínimo crítico: {data.parametrizacao.minimo ?? "—"}</p>
            <p>
              Quantidade atual (referência, não usada na sugestão): {data.parametrizacao.quantidadeAtual ?? "—"}
              {data.parametrizacao.quantidadeAtualEm && ` — registrada em ${new Date(data.parametrizacao.quantidadeAtualEm).toLocaleDateString("pt-BR")}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Parametrização atual: não registrada</p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Histórico</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Abastecido</TableHead>
              <TableHead className="text-right">Vendido</TableHead>
              <TableHead className="text-right">Perdido</TableHead>
              <TableHead className="text-right">Receita</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.historicoMensal.map((m) => (
              <TableRow key={m.period}>
                <TableCell>{m.period}</TableCell>
                <TableCell className="text-right tabular">{m.abastecido}</TableCell>
                <TableCell className="text-right tabular">{m.vendido}</TableCell>
                <TableCell className="text-right tabular">{m.perdido}</TableCell>
                <TableCell className="text-right tabular">{formatCents(m.receitaCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Tendência</h3>
        <p className="text-sm">{TREND_LABEL[data.tendencia]}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Inteligência de Perdas</h3>
        {data.sinalPerdas ? (
          <p className="text-sm">
            {LOSS_ACTION_LABEL[data.sinalPerdas.acao]} — escopo: {ESCOPO_LABEL[data.sinalPerdas.escopoProblema]}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum sinal ativo da Inteligência de Perdas.</p>
        )}
      </section>

      {data.sinalPerdas && (
        <section>
          <h3 className="mb-1 text-sm font-medium">Comparação com a rede</h3>
          <p className="text-sm text-muted-foreground">Escopo do problema: {ESCOPO_LABEL[data.sinalPerdas.escopoProblema]}.</p>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-sm font-medium">Quantidade</h3>
        <p className="text-sm">
          Necessidade estimada: {data.faixaEstimada.min}–{data.faixaEstimada.max} unidades
        </p>
        <p className="text-sm">Sugestão operacional: {data.quantidadeSugeridaIA} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Confiança</h3>
        <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[data.confianca]} />
      </section>

      {data.limitacoes.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning">
          <p className="font-medium">Limitações</p>
          <ul className="list-disc pl-4 text-xs">
            {data.limitacoes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function OpportunityBody({ data }: { data: Extract<RestockDisplayRow, { kind: "oportunidade" }>["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Ação recomendada</h3>
        <p className="text-sm">Sugestão: {data.quantidadeTeste} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Por que?</h3>
        <p className="text-sm">{data.evidencia}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          SKU ausente nesta loja — candidato baseado em bom desempenho na rede, não em histórico direto do par loja×produto.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Confiança</h3>
        <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[data.confianca]} />
      </section>
    </>
  );
}
