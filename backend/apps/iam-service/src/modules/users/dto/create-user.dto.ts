import { ApiProperty } from '@nestjs/swagger'
import { ArrayNotEmpty, IsArray, IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator'

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  password: string

  @ApiProperty({ example: ['operator'], description: 'Role names, not permission names.' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roles: string[]
}
