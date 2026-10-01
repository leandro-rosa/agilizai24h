import { Global, Module } from '@nestjs/common'
import { ParametersController } from './parameters.controller'
import { ParametersService } from './parameters.service'

@Global()
@Module({ controllers: [ParametersController], providers: [ParametersService], exports: [ParametersService] })
export class ParametersModule {}
