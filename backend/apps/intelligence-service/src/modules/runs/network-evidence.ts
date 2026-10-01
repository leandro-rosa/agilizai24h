import type { Alert } from '../engine/alerts'
import type { NetworkEvidence } from '../engine/engine.types'
import type { Parameters } from '../parameters/parameters.types'

/** What a finished store contributes to the network view of one SKU. */
export interface SkuStoreFlags {
  storeId: number
  exposed: boolean
  removalPattern: boolean
  damage: boolean
}

/** Per SKU: the stores where it was exposed long enough, those showing the removal pattern, those with damage. */
export function networkEvidenceBySku(flags: Map<string, SkuStoreFlags[]>): Map<string, NetworkEvidence> {
  const out = new Map<string, NetworkEvidence>()

  for (const [sku, stores] of flags) {
    const exposed = stores.filter(store => store.exposed)
    out.set(sku, {
      exposedStores: exposed.length,
      storesWithRemovalPattern: exposed.filter(store => store.removalPattern).length,
      storesWithDamage: stores.filter(store => store.damage).length,
    })
  }

  return out
}

export function damageScope(network: NetworkEvidence): NonNullable<Alert['scope']> {
  const stores = network.storesWithDamage
  return stores <= 1 ? 'local' : stores > network.exposedStores / 2 ? 'network' : 'several_stores'
}

/** True when the same removal pattern shows in MORE than the configured share of the stores that exposed the SKU. */
export function removalPatternInNetwork(network: NetworkEvidence, p: Parameters['mix']): boolean {
  return network.exposedStores > 0 && network.storesWithRemovalPattern / network.exposedStores > p.networkMajorityShare
}
