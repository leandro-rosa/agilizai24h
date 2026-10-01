import { SalesClient } from './sales.client'
import { SupplyClient } from './supply.client'
import { ProductsClient } from './products.client'
import { StoresClient } from './stores.client'

describe('the source clients are read-only', () => {
  const methodsOf = (client: { prototype: object }) =>
    Object.getOwnPropertyNames(client.prototype).filter(name => name !== 'constructor')

  it('expose no write-looking call to any sibling service', () => {
    const names = [SupplyClient, SalesClient, ProductsClient, StoresClient].flatMap(methodsOf)

    expect(names.filter(name => /^(create|update|delete|set|put|post|patch|write|save|import)/i.test(name))).toEqual([])
  })
})
