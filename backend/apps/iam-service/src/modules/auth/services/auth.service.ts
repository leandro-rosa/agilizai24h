import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { SessionRepository } from '../../db-client/repositories/session.repository'
import { UserRepository } from '../../db-client/repositories/user.repository'
import { resolveEffectivePermissions, resolveRoleNames } from '../utils/permissions'
import { clearedState, isThrottled, nextStateAfterFailure } from '../utils/throttle'
import { PasswordService } from './password.service'
import { SessionTokenService } from './session-token.service'

export interface AuthenticatedIdentity {
  id: number
  email: string
  name: string
  roles: string[]
  permissions: string[]
}

export interface LoginResult extends AuthenticatedIdentity {
  token: string
  expiresAt: Date
}

export type IntrospectionResult =
  | ({ valid: true; expiresAt: Date } & AuthenticatedIdentity)
  | { valid: false; reason: 'unknown' | 'expired' | 'revoked' | 'inactive' }

/** One message for every credential failure — never reveals which half was wrong. */
const INVALID_CREDENTIALS = 'Invalid credentials'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: SessionTokenService,
    private readonly prisma: PrismaClientService,
    private readonly config: ConfigService,
  ) {}

  private get sessionTtlSeconds(): number {
    return this.config.get<number>('SESSION_TTL_SECONDS') ?? 60 * 60 * 8
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const now = new Date()
    const user = await this.users.findByEmailWithPermissions(email)

    // No account: still burn comparable CPU, so timing cannot enumerate accounts.
    if (!user) {
      await this.passwords.dummyVerify()
      throw new UnauthorizedException(INVALID_CREDENTIALS)
    }

    // A deactivated account must be indistinguishable from a wrong password —
    // the response must not confirm that the account exists.
    if (!user.is_active) {
      await this.passwords.dummyVerify()
      throw new UnauthorizedException(INVALID_CREDENTIALS)
    }

    // Throttling is checked before the password, so a locked account rejects
    // even a correct credential for the cooling-off window.
    if (isThrottled(user, now)) {
      this.logger.warn(`Rejected login for throttled account ${user.id}`)
      throw new UnauthorizedException(INVALID_CREDENTIALS)
    }

    const matches = await this.passwords.verify(user.password_hash, password)

    if (!matches) {
      const next = nextStateAfterFailure(
        user,
        now,
        this.config.get<number>('AUTH_MAX_FAILED_ATTEMPTS') ?? 5,
        this.config.get<number>('AUTH_THROTTLE_SECONDS') ?? 900,
      )
      await this.users.update(user.id, next)
      throw new UnauthorizedException(INVALID_CREDENTIALS)
    }

    const token = this.tokens.generate()
    const expiresAt = new Date(now.getTime() + this.sessionTtlSeconds * 1000)

    await this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: clearedState() })
      await tx.session.create({
        data: { token_hash: this.tokens.hash(token), user_id: user.id, expires_at: expiresAt },
      })
    })

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: resolveRoleNames(user),
      permissions: resolveEffectivePermissions(user),
      token,
      expiresAt,
    }
  }

  /**
   * Resolves a session token for the gateway. Deliberately does NOT extend the
   * session's expiry — introspection runs on every request, so extending here
   * would make sessions effectively immortal for any active user.
   */
  async introspect(token: string): Promise<IntrospectionResult> {
    const session = await this.sessions.findByTokenHashWithUser(this.tokens.hash(token))

    if (!session) return { valid: false, reason: 'unknown' }
    if (session.revoked_at !== null) return { valid: false, reason: 'revoked' }
    if (session.expires_at.getTime() <= Date.now()) return { valid: false, reason: 'expired' }
    if (!session.user.is_active) return { valid: false, reason: 'inactive' }

    return {
      valid: true,
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      // Resolved on every call rather than captured at login, so a revoked role
      // takes effect on the next request without forcing a re-login.
      roles: resolveRoleNames(session.user),
      permissions: resolveEffectivePermissions(session.user),
      expiresAt: session.expires_at,
    }
  }

  /** Revokes immediately — the very next use of the token is rejected. */
  async logout(token: string): Promise<void> {
    const tokenHash = this.tokens.hash(token)
    const session = await this.sessions.findFirst({ where: { token_hash: tokenHash, revoked_at: null } })

    if (!session?.id) return

    await this.sessions.update(session.id, { revoked_at: new Date() })
  }
}
