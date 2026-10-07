import { UpstreamStatusError } from '../modules/upstream/upstream.client'
import { UpstreamExceptionFilter } from './upstream-exception.filter'

const run = (error: UpstreamStatusError) => {
  const send = jest.fn()
  const reply = { status: jest.fn(() => ({ send })) }
  new UpstreamExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => reply }) } as never)

  return { status: reply.status.mock.calls[0][0], body: send.mock.calls[0][0] }
}

describe('UpstreamExceptionFilter', () => {
  it('forwards the machine-readable reason of a conflict, so a screen can name the product that owns the EAN', () => {
    const { status, body } = run(new UpstreamStatusError('products', 409, { message: 'O EAN 789 pertence ao produto 110001', code: 'ean_linked', sku: '110001', ean_status: 'active' }))

    expect(status).toBe(409)
    expect(body).toMatchObject({ message: 'O EAN 789 pertence ao produto 110001', code: 'ean_linked', sku: '110001', ean_status: 'active', upstream: 'products' })
  })

  it('does not pass the rest of the upstream body, nor non-text values', () => {
    const { body } = run(new UpstreamStatusError('products', 400, { message: 'bad', stack: 'secret', sku: { nested: true }, code: 7 }))

    expect(body).not.toHaveProperty('stack')
    expect(body).not.toHaveProperty('sku')
    expect(body).not.toHaveProperty('code')
  })
})
