import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class CreateAliasDto {
  @ApiProperty({
    description: 'A grafia exatamente como aparece na origem — o normalizado é derivado daqui.',
    example: 'ASSAÍ ATACADISTA LJ49',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  alias: string
}
