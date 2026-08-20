import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsString } from 'class-validator'

export class ResolveSuppliersDto {
  @ApiProperty({
    description: 'Grafias vindas de um extrato, na ordem em que apareceram.',
    example: ['ASSAÍ ATACADISTA LJ49', 'AMLabs Ventures'],
  })
  @IsArray()
  @IsString({ each: true })
  // Um extrato mensal fica na casa das centenas de linhas; o teto existe para
  // um cliente distraído não pedir uma consulta ilimitada.
  @ArrayMaxSize(1000)
  names: string[]
}
