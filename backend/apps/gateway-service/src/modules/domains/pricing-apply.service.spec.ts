import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { PERMISSIONS } from '@app/iam-contracts'
import { REQUIRED_PERMISSION_KEY } from '../auth/guards/session.constants'
import { UpstreamStatusError } from '../upstream/upstream.client'
import { PricingController } from './controllers/pricing.controller'
import { PricingApplyService } from './pricing-apply.service'

type Call = { service: string; method: string; path: string; payload?: any }

function build(options: { priceWrite?: 'ok' | 'fail'; closeApplied?: 'ok' | 'fail'; existing?: string } = {}) {
  const state = { priceWrite: options.priceWrite ?? 'ok' }
  const calls: Call[] = []
  const decisions = new Map<string, any>()
  const domains = {
    intelligence: async (call: any) => {
      calls.push({ service: 'intelligence', method: call.method, path: call.path, payload: call.payload })
      if (call.path.includes('/new-product/')) {
        if (call.payload.choice === 'changed_by_hand' && !call.payload.reason) throw new UpstreamStatusError('intelligence', 400, { message: 'reason is required when the price is typed by hand' })
        return { data: { created: true, choice: { id: 'c-1', choice: call.payload.choice, actor: call.payload.actor } } }
      }
      if (call.path === '/pricing/decisions') {
        const key = call.payload.idempotencyKey
        const found = decisions.get(key)
        if (found) return { data: { created: false, decision: found } }
        const decision = { id: `d-${decisions.size + 1}`, sku: call.payload.sku, newPriceCents: call.payload.newPriceCents, effectiveFrom: '2026-10-07', status: options.existing ?? 'pending', actor: call.payload.actor, reason: call.payload.reason ?? null }
        decisions.set(key, decision)
        return { data: { created: true, decision } }
      }
      const id = call.path.split('/')[3]
      const decision = [...decisions.values()].find(candidate => candidate.id === id)!
      if (call.path.endsWith('/applied')) {
        if (options.closeApplied === 'fail') throw new Error('intelligence down')
        decision.status = 'applied'
      }
      if (call.path.endsWith('/failed')) {
        decision.status = 'failed'
        decision.error = call.payload.error
      }
      return { data: decision }
    },
    products: async (call: any) => {
      calls.push({ service: 'products', method: call.method, path: call.path, payload: call.payload })
      if (state.priceWrite === 'fail') throw new UpstreamStatusError('products', 404, { message: 'Unknown SKU COCA' })
      return { data: { sku: 'COCA' } }
    },
  }

  return { service: new PricingApplyService(domains as never), calls, decisions, state }
}

const input = (overrides: Record<string, unknown> = {}) => ({ idempotencyKey: 'k1', sku: 'COCA', newPriceCents: 650, ...overrides })
const writes = (calls: Call[]) => calls.filter(call => call.service === 'products')

describe('PricingApplyService', () => {
  it('records the decision, writes the price and closes it as applied, in that order', async () => {
    const { service, calls } = build()
    const result = await service.apply(input(), 'barbara@agiliz.ai', 'corr')

    expect(result).toMatchObject({ applied: true, alreadyApplied: false, decision: { status: 'applied', sku: 'COCA' } })
    expect(calls.map(call => `${call.service} ${call.path}`)).toEqual(['intelligence /pricing/decisions', 'products /products/COCA/prices', 'intelligence /pricing/decisions/d-1/applied'])
    expect(writes(calls)[0].payload).toEqual({ effective_from: '2026-10-07', price_cents: 650, source: 'pricing_intelligence', actor: 'barbara@agiliz.ai', source_ref: 'd-1' })
  })

  it('the actor is the session user and overrides whatever the client sent', async () => {
    const { service, calls } = build()
    await service.apply(input({ actor: 'someone-else@x.com' }), 'barbara@agiliz.ai')

    expect(calls[0].payload.actor).toBe('barbara@agiliz.ai')
  })

  it('a failed price write leaves a failed decision with the reason and tells the caller', async () => {
    const { service, calls, decisions } = build({ priceWrite: 'fail' })

    await expect(service.apply(input(), 'barbara@agiliz.ai')).rejects.toBeInstanceOf(UpstreamStatusError)
    const decision = decisions.get('k1')
    expect(decision).toMatchObject({ status: 'failed' })
    expect(decision.error).toContain('Unknown SKU COCA')
    expect(calls.some(call => call.path.endsWith('/applied'))).toBe(false)
  })

  it('the same request twice is one decision and one price write', async () => {
    const { service, calls, decisions } = build()
    await service.apply(input(), 'barbara@agiliz.ai')
    const second = await service.apply(input(), 'barbara@agiliz.ai')

    expect(second).toMatchObject({ applied: true, alreadyApplied: true })
    expect(decisions.size).toBe(1)
    expect(writes(calls)).toHaveLength(1)
  })

  it('retrying after a failed write tries the write again with the same key and can succeed', async () => {
    const { service, calls, decisions, state } = build({ priceWrite: 'fail' })
    await expect(service.apply(input(), 'barbara@agiliz.ai')).rejects.toBeDefined()
    expect(decisions.get('k1').status).toBe('failed')

    state.priceWrite = 'ok'
    const retried = await service.apply(input(), 'barbara@agiliz.ai')

    expect(retried).toMatchObject({ applied: true, alreadyApplied: false, decision: { status: 'applied' } })
    expect(decisions.size).toBe(1)
    expect(writes(calls)).toHaveLength(2)
  })

  it('reports a price that is in force but whose record could not be closed, instead of hiding it', async () => {
    const { service } = build({ closeApplied: 'fail' })
    const result = await service.apply(input(), 'barbara@agiliz.ai')

    expect(result).toMatchObject({ applied: true, decision: { status: 'pending' } })
    expect(result.warning).toContain('pendente')
  })

  it('requires an idempotency key before touching anything', async () => {
    const { service, calls } = build()

    await expect(service.apply(input({ idempotencyKey: '' }), 'a@b.c')).rejects.toBeInstanceOf(BadRequestException)
    expect(calls).toHaveLength(0)
  })
})

describe('the price carries its origin', () => {
  it('writes the approving user, the reason and the decision id as the idempotency key', async () => {
    const { service, calls } = build()
    await service.apply(input({ reason: 'concorrência' }), 'barbara@agiliz.ai')

    expect(writes(calls)[0].payload).toMatchObject({ source: 'pricing_intelligence', actor: 'barbara@agiliz.ai', reason: 'concorrência', source_ref: 'd-1' })
  })

  it('a retry after a failed write sends the same decision id, so the price is written once', async () => {
    const { service, calls, state } = build({ priceWrite: 'fail' })
    await expect(service.apply(input(), 'a@b.c')).rejects.toBeDefined()
    state.priceWrite = 'ok'
    await service.apply(input(), 'a@b.c')

    expect(writes(calls).map(call => call.payload.source_ref)).toEqual(['d-1', 'd-1'])
  })
})

describe('permissions', () => {
  const permissionOf = (method: keyof PricingController) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, PricingController.prototype[method])

  it('applying a price, editing the rules and listing pending decisions need the product write permission', () => {
    expect(permissionOf('apply')).toBe(PERMISSIONS.PRODUCTS_WRITE)
    expect(permissionOf('createParameters')).toBe(PERMISSIONS.PRODUCTS_WRITE)
    expect(permissionOf('pending')).toBe(PERMISSIONS.PRODUCTS_WRITE)
  })

  it('reading, running and simulating need only the product read permission', () => {
    for (const method of ['latest', 'startRun', 'run', 'history', 'stores', 'simulate', 'decisions', 'currentParameters', 'parameterVersions'] as const) {
      expect(permissionOf(method)).toBe(PERMISSIONS.PRODUCTS_READ)
    }
  })
})

describe('the price of a product registered from an invoice', () => {
  const choose = (over: Record<string, unknown> = {}) => ({ idempotencyKey: 'n1', choice: 'suggested_accepted', chosenPriceCents: 610, costCents: 309, costOrigin: 'Nota fiscal 13021', ...over })

  it('records the choice first, then writes the chosen price through the same apply path, keyed to the choice', async () => {
    const { service, calls } = build()
    const result = await service.chooseForNewProduct('110024', choose(), 'ana@agiliz.ai', 'corr')

    expect(calls.map(c => `${c.service} ${c.path}`)).toEqual(['intelligence /pricing/new-product/110024/choice', 'intelligence /pricing/decisions', 'products /products/110024/prices', 'intelligence /pricing/decisions/d-1/applied'])
    expect(calls[1].payload).toMatchObject({ idempotencyKey: 'new-product:n1', sku: '110024', newPriceCents: 610, actor: 'ana@agiliz.ai' })
    expect(writes(calls)[0].payload).toMatchObject({ source: 'pricing_intelligence', actor: 'ana@agiliz.ai', price_cents: 610 })
    expect(result.applied?.applied).toBe(true)
  })

  it('saving without a price writes nothing in products and records only the choice', async () => {
    const { service, calls } = build()
    const result = await service.chooseForNewProduct('110024', choose({ choice: 'left_without_price', chosenPriceCents: undefined }), 'ana@agiliz.ai')

    expect(calls.map(c => c.path)).toEqual(['/pricing/new-product/110024/choice'])
    expect(writes(calls)).toHaveLength(0)
    expect(result.applied).toBeNull()
  })

  it('a choice the engine refuses writes no price', async () => {
    const { service, calls } = build()

    await expect(service.chooseForNewProduct('110024', choose({ choice: 'changed_by_hand', chosenPriceCents: 690 }), 'ana@agiliz.ai')).rejects.toThrow()
    expect(writes(calls)).toHaveLength(0)
    expect(calls.map(c => c.path)).toEqual(['/pricing/new-product/110024/choice'])
  })

  it('the user is the session user, never the one in the body, and a key is required', async () => {
    const { service, calls } = build()
    await service.chooseForNewProduct('110024', choose({ actor: 'forjado@x' }), 'ana@agiliz.ai')
    expect(calls[0].payload.actor).toBe('ana@agiliz.ai')

    await expect(service.chooseForNewProduct('110024', choose({ idempotencyKey: '' }), 'ana@agiliz.ai')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('reading the suggestion needs read, choosing needs write', () => {
    const permission = (method: keyof PricingController) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, PricingController.prototype[method])

    expect(permission('newProduct')).toBe(PERMISSIONS.PRODUCTS_READ)
    expect(permission('newProductChoices')).toBe(PERMISSIONS.PRODUCTS_READ)
    expect(permission('chooseNewProductPrice')).toBe(PERMISSIONS.PRODUCTS_WRITE)
  })
})
