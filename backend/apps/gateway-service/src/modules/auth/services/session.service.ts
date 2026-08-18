import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import type { SessionIntrospection } from '@app/iam-contracts'
import { IamClient } from '../../upstream/iam.client'
import { UpstreamUnreachableError } from '../../upstream/upstream.client'

export interface AuthenticatedCaller {
  id: number
  email: string
  name: string
  roles: string[]
  permissions: string[]
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name)

  constructor(private readonly iam: IamClient) {}

  /**
   * Resolves the caller for a request.
   *
   * Deliberately performs no caching. iam's spec promises that logout revokes
   * immediately and that a permission change takes effect on the next request;
   * any cache — even a few seconds — breaks both, and does so intermittently,
   * which is the worst way for a security control to fail.
   *
   * Throws 401 when the session is genuinely unusable, and 503 when we could
   * not find out. Collapsing those two is what causes a dependency blip to log
   * the whole company out.
   */
  async resolve(token: string, correlationId?: string): Promise<AuthenticatedCaller> {
    let introspection: SessionIntrospection

    try {
      introspection = await this.iam.introspect(token, correlationId)
    } catch (error) {
      if (error instanceof UpstreamUnreachableError) {
        this.logger.error('Identity service unreachable — refusing the request without invalidating the session')
        throw new ServiceUnavailableException('Identity service is unavailable, try again shortly')
      }

      // A non-2xx from IAM is also "we could not find out", not "you are out".
      this.logger.error('Identity service returned an unexpected status during introspection')
      throw new ServiceUnavailableException('Identity service is unavailable, try again shortly')
    }

    if (!introspection.valid) {
      throw new UnauthorizedException(`Session is not valid${introspection.reason ? ` (${introspection.reason})` : ''}`)
    }

    return {
      id: introspection.id!,
      email: introspection.email!,
      name: introspection.name!,
      roles: introspection.roles ?? [],
      permissions: introspection.permissions ?? [],
    }
  }
}
