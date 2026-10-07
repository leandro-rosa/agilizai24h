import 'reflect-metadata'
import { PERMISSIONS } from '@app/iam-contracts'
import { REQUIRED_PERMISSION_KEY } from '../../auth/guards/session.constants'
import { ProductsController } from './products.controller'

const permissionOf = (method: keyof ProductsController) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, ProductsController.prototype[method])

describe('product routes and their permissions', () => {
  it('recording a cost, a price or an EAN, and changing an EAN, need the product write permission', () => {
    for (const method of ['recordCost', 'recordPrice', 'addEan', 'updateEan'] as const) expect(permissionOf(method)).toBe(PERMISSIONS.PRODUCTS_WRITE)
  })

  it('reading histories, margins, prices and EANs, and resolving an EAN, need only the read permission', () => {
    for (const method of ['listCosts', 'listPrices', 'bulkPrices', 'timeline', 'priceMargins', 'listEans', 'resolveEans'] as const) expect(permissionOf(method)).toBe(PERMISSIONS.PRODUCTS_READ)
  })

  it('there is no route to delete an EAN', () => {
    const routes = Object.getOwnPropertyNames(ProductsController.prototype)

    expect(routes.some(name => /delete.*ean|remove.*ean/i.test(name))).toBe(false)
  })
})
