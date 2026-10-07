import 'reflect-metadata'
import { PERMISSIONS } from '@app/iam-contracts'
import { REQUIRED_PERMISSION_KEY } from '../../auth/guards/session.constants'
import { CatalogueController, CatalogueImportController, ProductsController, TaxonomyController } from './products.controller'

const permissionOf = (method: keyof ProductsController) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, ProductsController.prototype[method])

describe('product routes and their permissions', () => {
  it('recording a cost, a price or an EAN, and changing an EAN, need the product write permission', () => {
    for (const method of ['recordCost', 'recordPrice', 'addEan', 'updateEan', 'createFromInvoice'] as const) expect(permissionOf(method)).toBe(PERMISSIONS.PRODUCTS_WRITE)
  })

  it('reading histories, margins, prices and EANs, and resolving an EAN, need only the read permission', () => {
    for (const method of ['listCosts', 'listPrices', 'bulkPrices', 'timeline', 'priceMargins', 'listEans', 'resolveEans', 'nextSku'] as const) expect(permissionOf(method)).toBe(PERMISSIONS.PRODUCTS_READ)
  })

  it('there is no route to delete an EAN', () => {
    const routes = Object.getOwnPropertyNames(ProductsController.prototype)

    expect(routes.some(name => /delete.*ean|remove.*ean/i.test(name))).toBe(false)
  })
})

describe('catalogue import and last change', () => {
  it('importing (even the preview) needs the product write permission; reading the last change only read', () => {
    const permission = (target: object, method: string) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, (target as Record<string, object>)[method])

    expect(permission(CatalogueImportController.prototype, 'preview')).toBe(PERMISSIONS.PRODUCTS_WRITE)
    expect(permission(CatalogueImportController.prototype, 'apply')).toBe(PERMISSIONS.PRODUCTS_WRITE)
    expect(permission(CatalogueController.prototype, 'lastChange')).toBe(PERMISSIONS.PRODUCTS_READ)
  })
})

describe('taxonomy and classification routes', () => {
  const permission = (method: keyof TaxonomyController) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, TaxonomyController.prototype[method])

  it('reading the categories, suggesting and reviewing a classification need only read; changing anything needs write', () => {
    for (const method of ['categories', 'suggest', 'review'] as const) expect(permission(method)).toBe(PERMISSIONS.PRODUCTS_READ)
    for (const method of ['createCategory', 'updateCategory', 'createSubcategory', 'updateSubcategory', 'apply'] as const) expect(permission(method)).toBe(PERMISSIONS.PRODUCTS_WRITE)
  })

  it('there is no delete route for a category or a subcategory', () => {
    expect(Object.getOwnPropertyNames(TaxonomyController.prototype).filter(name => /delete|remove/i.test(name))).toEqual([])
  })
})
