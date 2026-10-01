import { Global, Module } from '@nestjs/common'
import { ProductStoreFlagRepository } from './product-store-flag.repository'

@Global()
@Module({ providers: [ProductStoreFlagRepository], exports: [ProductStoreFlagRepository] })
export class FlagsModule {}
