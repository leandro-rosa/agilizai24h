import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsString } from 'class-validator'

export class SetRolesDto {
  @ApiProperty({ example: ['operator'] })
  @IsArray()
  @IsString({ each: true })
  roles: string[]
}
