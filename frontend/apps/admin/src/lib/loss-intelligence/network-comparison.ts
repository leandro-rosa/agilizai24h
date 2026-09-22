import type { NetworkComparison } from "./types";
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
