import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { PermissionName } from '@app/iam-contracts'
import { SessionService } from '../services/session.service'
import { IS_PUBLIC_KEY, PUBLIC_PATH_PREFIXES, REQUIRED_PERMISSION_KEY, SESSION_COOKIE } from './session.constants'

/**
 * The platform's trust boundary. Fails closed: if the session cannot be
 * validated for any reason, the request never reaches a domain service. A 503
 * that blocks legitimate work during an outage is strictly better than serving
 * data to an unvalidated caller.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest()

    // Path-based exemption for controllers this service does not declare —
    // notably @app/health's, which cannot carry @Public().
    const path: string = request.url ?? ''
    if (PUBLIC_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))) {
      return true
    }

    const token = request.cookies?.[SESSION_COOKIE]

    // No session at all: rejected without troubling any downstream service.
    if (!token) throw new UnauthorizedException('Authentication required')

    // Throws 401 for an invalid session, 503 when IAM could not be reached.
    const caller = await this.sessions.resolve(token, request.correlationId)
    request.caller = caller

    const required = this.reflector.getAllAndOverride<PermissionName | undefined>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required) return true

    if (!caller.permissions.includes(required)) {
      // 403, distinctly from 401: the caller is authenticated, just not
      // permitted. The panel must not send them to the login screen for this.
      throw new ForbiddenException(`Missing permission ${required}`)
    }

    return true
  }
}
