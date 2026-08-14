import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PartnerIntakeDto } from './partner-intake.dto'

describe('PartnerIntakeDto', () => {
  it('rejects original field values over 200 characters', async () => {
    const dto = plainToInstance(PartnerIntakeDto, {
      displayName: 'Quote',
      partnerName: 'Partner',
      externalId: 'EXT-1',
      lines: [{ originalFields: [{ key: 'sku', value: 'x'.repeat(201) }] }],
    })

    const errors = await validate(dto)

    expect(errors).not.toHaveLength(0)
  })
})
