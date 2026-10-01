import { Global, Module } from '@nestjs/common'
import { BaselineRepository } from './baseline.repository'

@Global()
@Module({ providers: [BaselineRepository], exports: [BaselineRepository] })
export class BaselineModule {}
