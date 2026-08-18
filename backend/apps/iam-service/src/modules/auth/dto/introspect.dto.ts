import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class IntrospectDto {
  @ApiProperty({ description: 'The opaque session token issued at login.' })
  @IsString()
  @IsNotEmpty()
  token: string
}
