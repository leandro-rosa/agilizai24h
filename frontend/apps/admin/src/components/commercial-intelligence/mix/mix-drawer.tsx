"use client";

import { ConfidenceBadge } from "@/components/commercial-intelligence/confidence-badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Level } from "@/lib/commercial-intelligence/types";
import type { Confidence } from "@/lib/loss-intelligence/types";
import { date } from "@/lib/format";
import type { MixDisplayRow, MixOpportunityRow } from "./mix-table";

const CONFIDENCE_TO_LEVEL: Record<Confidence, Level> = { alta: "high", media: "medium", baixa: "low", insuficiente: "insufficient" };
const TREND_LABEL: Record<string, string> = { crescendo: "Crescendo", estavel: "Estável", caindo: "Caindo", volatil: "Volátil", indeterminada: "Indeterminada" };
const ESCOPO_LABEL: Record<string, string> = { local: "Local", multiplas_lojas: "Múltiplas lojas", rede: "Rede", indeterminado: "Indeterminado" };
const LOSS_ACTION_LABEL: Record<string, string> = {
  manter: "Manter", manter_monitorar: "Manter e monitorar", reduzir_abastecimento: "Reduzir abastecimento", investigar: "Investigar",
  suspender_abastecimento: "Suspender abastecimento", avaliar_retirada_loja: "Avaliar retirada (loja)", avaliar_retirada_rede: "Avaliar retirada (rede)",
  avaliar_permanencia_loja: "Avaliar permanência (loja)", avaliar_permanencia_rede: "Avaliar permanência (rede)", dados_insuficientes: "Dados insuficientes",
};

export type MixDrawerRow = ({ variant: "recomendacao" } & MixDisplayRow) | ({ variant: "oportunidade" } & MixOpportunityRow);

export function MixDrawer({ row, open, onOpenChange }: { row: MixDrawerRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {row.productLabel} — {row.storeName}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">{row.variant === "recomendacao" ? <RecommendationBody data={row.data} /> : <OpportunityBody data={row.data} />}</div>
      </SheetContent>
    </Sheet>
  );
}

function RecommendationBody({ data }: { data: MixDisplayRow["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Evidência</h3>
        <p className="text-sm">{data.evidencia}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Situação</h3>
        <p className="text-sm">{TREND_LABEL[data.tendencia]}</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Parametrização atual</h3>
        {data.parametrizacao ? (
          <div className="text-sm text-muted-foreground">
            <p>Nível de par: {data.parametrizacao.nivelDePar ?? "—"}</p>
            <p>Mínimo crítico: {data.parametrizacao.minimo ?? "—"}</p>
            <p>
              Quantidade atual (referência, não usada na sugestão): {data.parametrizacao.quantidadeAtual ?? "—"}
              {data.parametrizacao.quantidadeAtualEm && ` — registrada em ${date(data.parametrizacao.quantidadeAtualEm)}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Parametrização atual: não registrada</p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Indicadores</h3>
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="text-muted-foreground">Afinidade com a rede</dt>
          <dd className="tabular">{data.affinity !== null ? `${data.affinity.toFixed(1)}x a participação esperada pela rede` : "desconhecida"}</dd>
          <dt className="text-muted-foreground">Margem</dt>
          <dd className="tabular">{data.margemPct !== null ? `${Math.round(data.margemPct * 100)}% de margem sobre a receita` : "desconhecida"}</dd>
        </dl>
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

function OpportunityBody({ data }: { data: MixOpportunityRow["data"] }) {
  return (
    <>
      <section>
        <h3 className="mb-1 text-sm font-medium">Por que?</h3>
        <p className="text-sm">{data.evidencia}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          SKU ausente nesta loja — candidato baseado em bom desempenho na rede, não em histórico direto do par loja×produto.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Quantidade</h3>
        <p className="text-sm">Quantidade de teste: {data.quantidadeTeste} unidades</p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Confiança</h3>
        <ConfidenceBadge level={CONFIDENCE_TO_LEVEL[data.confianca]} />
      </section>
    </>
  );
}
