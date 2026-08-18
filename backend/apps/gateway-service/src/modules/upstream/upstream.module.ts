import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { DomainClient } from './domain.client'
import { IamClient } from './iam.client'
import { UpstreamClient } from './upstream.client'

/** Global: guards and every domain controller need a client. */
@Global()
@Module({
  imports: [HttpClientModule],
  providers: [UpstreamClient, IamClient, DomainClient],
  exports: [UpstreamClient, IamClient, DomainClient],
})
export class UpstreamModule {}
