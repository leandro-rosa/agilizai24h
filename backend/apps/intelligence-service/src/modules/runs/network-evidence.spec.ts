import { DEFAULT_PARAMETERS } from '../parameters/parameters.defaults'
import { damageScope, networkEvidenceBySku, removalPatternInNetwork, type SkuStoreFlags } from './network-evidence'

const flag = (storeId: number, over: Partial<SkuStoreFlags> = {}): SkuStoreFlags => ({ storeId, exposed: true, removalPattern: false, damage: false, ...over })

describe('network evidence', () => {
  it('counts only the stores that exposed the SKU for the exposure, but every store with damage', () => {
    const evidence = networkEvidenceBySku(new Map([['A', [flag(1, { removalPattern: true }), flag(2), flag(3, { exposed: false, damage: true })]]]))

    expect(evidence.get('A')).toEqual({ exposedStores: 2, storesWithRemovalPattern: 1, storesWithDamage: 1 })
  })

  it('removal from the network needs MORE than half of the exposed stores', () => {
    const p = DEFAULT_PARAMETERS.mix

    expect(removalPatternInNetwork({ exposedStores: 10, storesWithRemovalPattern: 6, storesWithDamage: 0 }, p)).toBe(true)
    expect(removalPatternInNetwork({ exposedStores: 10, storesWithRemovalPattern: 5, storesWithDamage: 0 }, p)).toBe(false)
    expect(removalPatternInNetwork({ exposedStores: 0, storesWithRemovalPattern: 0, storesWithDamage: 0 }, p)).toBe(false)
  })

  it('damage scope: local, several stores, network', () => {
    expect(damageScope({ exposedStores: 10, storesWithRemovalPattern: 0, storesWithDamage: 1 })).toBe('local')
    expect(damageScope({ exposedStores: 10, storesWithRemovalPattern: 0, storesWithDamage: 3 })).toBe('several_stores')
    expect(damageScope({ exposedStores: 10, storesWithRemovalPattern: 0, storesWithDamage: 8 })).toBe('network')
  })
})
