import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ParametersService } from './parameters.service'
import type { DeepPartial, Parameters } from './parameters.types'
import { ParametersInvalidError } from './parameters.validation'

/**
 * Internal routes — there is no gateway route and no screen in this phase. The
 * owner recalibrates by creating a new version; nothing here edits or deletes
 * an earlier one.
 */
@ApiTags('parameters')
@Controller('parameters')
export class ParametersController {
  constructor(private readonly parameters: ParametersService) {}

  @Get('current')
  @ApiOperation({ summary: 'The latest parameter version, each parameter labelled provisional or not' })
  current() {
    return this.parameters.current()
  }

  @Get('versions')
  @ApiOperation({ summary: 'Every parameter version, newest first' })
  versions() {
    return this.parameters.list()
  }

  @Get('versions/:id')
  @ApiOperation({ summary: 'One historical parameter version, with the values in force then' })
  version(@Param('id', ParseIntPipe) id: number) {
    return this.parameters.byId(id)
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new parameter version from the current one plus a partial change',
    description: 'The result is validated as a whole. An earlier version is never edited.',
  })
  async create(@Body() body: { values?: DeepPartial<Parameters>; note?: string }) {
    if (!body?.values || typeof body.values !== 'object') throw new BadRequestException('values is required')

    try {
      return await this.parameters.createVersion(body.values, body.note)
    } catch (error) {
      if (error instanceof ParametersInvalidError) throw new BadRequestException({ message: error.message, problems: error.problems })
      throw error
    }
  }
}
