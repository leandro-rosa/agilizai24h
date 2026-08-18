import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean } from 'class-validator'

export class SetActiveDto {
  @ApiProperty({ description: 'Deactivating also revokes every live session for the account.' })
  @IsBoolean()
  is_active: boolean
}
