import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { CreateUserDto } from '../dto/create-user.dto'
import { SetActiveDto } from '../dto/set-active.dto'
import { SetRolesDto } from '../dto/set-roles.dto'
import { UsersService } from '../services/users.service'

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List accounts' })
  list() {
    return this.users.list()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve one account' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.users.findById(id)
  }

  @Post()
  @ApiOperation({ summary: 'Create an account', description: 'Administrator-only; there is no self-registration.' })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto.email, dto.name, dto.password, dto.roles)
  }

  @Patch(':id/active')
  @ApiOperation({
    summary: 'Activate or deactivate an account',
    description: 'Deactivating revokes every live session for the account in the same transaction.',
  })
  setActive(@Param('id', ParseIntPipe) id: number, @Body() dto: SetActiveDto) {
    return this.users.setActive(id, dto.is_active)
  }

  @Patch(':id/roles')
  @ApiOperation({
    summary: 'Replace an account roles',
    description: 'Takes effect on the next introspection — existing sessions are not revoked.',
  })
  setRoles(@Param('id', ParseIntPipe) id: number, @Body() dto: SetRolesDto) {
    return this.users.setRoles(id, dto.roles)
  }
}
