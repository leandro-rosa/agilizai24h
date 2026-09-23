import type { EscopoProblema, NetworkComparison } from "./types";
import type { LossIntelligenceParameters } from "./parameters";

export interface StoreSignal {
  storeId: number;
  storeName: string;
  qtyRestocked: number;
  qtySold: number;
  /** Definido por quem chama — cada árvore de diagnóstico decide o que conta como "lado ruim" para o seu motivo. */
  hasBadSignal: boolean;
}

export interface NetworkComparisonInput {
  perStore: StoreSignal[];
  parameters: LossIntelligenceParameters;
}

export function computeNetworkComparison(input: NetworkComparisonInput): NetworkComparison {
  const storesCarryingSku = input.perStore.filter((store) => store.qtyRestocked > 0 || store.qtySold > 0);

  if (storesCarryingSku.length < input.parameters.network.minStoresForNetworkVerdict) {
    return "dado_insuficiente";
  }

  const storesWithSameSignal = storesCarryingSku.filter((store) => store.hasBadSignal);
  const storesHealthy = storesCarryingSku.filter((store) => !store.hasBadSignal).map((store) => store.storeName);

  return {
    storesCarryingSku: storesCarryingSku.length,
    storesWithSameSignal: storesWithSameSignal.length,
    affectedShare: storesWithSameSignal.length / storesCarryingSku.length,
    storesHealthy,
  };
}

/**
 * Bucketa `affectedShare` (§12) em Local/Múltiplas lojas/Rede — descreve distribuição, nunca causa
 * (adenda 2026-09-23 §A). Mesmos limiares que já decidem os casos D/E de validade e o caso severo
 * de Outro motivo (§10.1, §10.2) — nenhum parâmetro novo, só a leitura explícita do valor entre eles.
 * "indeterminado" quando a comparação de rede não pôde ser calculada (poucas lojas comparáveis).
 */
export function deriveEscopoProblemaFromNetworkComparison(
  comparison: NetworkComparison,
  parameters: Pick<LossIntelligenceParameters["validity"], "localOutlierMaxShare" | "networkWideMinShare">,
): EscopoProblema {
  if (comparison === "dado_insuficiente") return "indeterminado";
  if (comparison.affectedShare <= parameters.localOutlierMaxShare) return "local";
  if (comparison.affectedShare >= parameters.networkWideMinShare) return "rede";
  return "multiplas_lojas";
}
