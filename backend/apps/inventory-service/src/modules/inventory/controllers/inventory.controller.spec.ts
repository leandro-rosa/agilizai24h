import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { BulkSetParametrizacaoDto } from './inventory.controller'

describe('BulkSetParametrizacaoDto', () => {
  it('accepts an item with no minimum yet — a par_level/current_quantity-only row is a real, documented state (schema.prisma: minimum is nullable)', async () => {
    const dto = plainToInstance(BulkSetParametrizacaoDto, { items: [{ sku: 'SKU-1', parLevel: 8 }] })
    const errors = await validate(dto)
    expect(errors).toHaveLength(0)
  })

  it('still rejects a negative minimum when one is provided', async () => {
    const dto = plainToInstance(BulkSetParametrizacaoDto, { items: [{ sku: 'SKU-1', minimum: -1 }] })
    const errors = await validate(dto)
    expect(errors.length).toBeGreaterThan(0)
  })
})
