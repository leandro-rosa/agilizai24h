import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { AuthService } from '../src/modules/auth/services/auth.service'
import { SessionTokenService } from '../src/modules/auth/services/session-token.service'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'
import { UsersService } from '../src/modules/users/services/users.service'

/**
 * Runs against the Postgres from this service's docker-compose. Every scenario
 * in the `iam` spec that needs real persistence lives here; the pure logic is
 * covered by the colocated unit specs.
 */
describe('iam integration', () => {
  let app: TestingModule
  let auth: AuthService
  let users: UsersService
  let prisma: PrismaClientService
  let tokens: SessionTokenService

  const password = 'a-sufficiently-long-password'
  const createdEmails: string[] = []

  const uniqueEmail = (label: string) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`
    createdEmails.push(email)
    return email
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile()

    app = await moduleRef.init()
    auth = app.get(AuthService)
    users = app.get(UsersService)
    prisma = app.get(PrismaClientService)
    tokens = app.get(SessionTokenService)
  }, 60000)

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
    }
    await app?.close()
  }, 30000)

  const createOperator = async (label: string) => {
    const email = uniqueEmail(label)
    const user = await users.create(email, 'Test User', password, ['operator'])
    return { email, user }
  }

  describe('credential storage', () => {
    it('never persists the password in plaintext', async () => {
      const { user } = await createOperator('plaintext')
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })

      expect(row.password_hash).not.toContain(password)
      expect(row.password_hash).toMatch(/^\$argon2id\$/)
    })

    it('never returns a password or hash from any user-facing shape', async () => {
      const { user } = await createOperator('noleak')
      const view = await users.findById(user.id)

      expect(JSON.stringify(view)).not.toContain(password)
      expect(view).not.toHaveProperty('password_hash')
    })
  })

  describe('accounts', () => {
    it('rejects a duplicate email and leaves the original untouched', async () => {
      const { email } = await createOperator('dup')

      await expect(users.create(email, 'Other', password, ['operator'])).rejects.toThrow(/already exists/)
      expect(await prisma.user.count({ where: { email } })).toBe(1)
    })

    it('refuses to authenticate a deactivated account without revealing it exists', async () => {
      const { email, user } = await createOperator('inactive')
      await users.setActive(user.id, false)

      await expect(auth.login(email, password)).rejects.toThrow('Invalid credentials')
    })
  })

  describe('login', () => {
    it('issues a session for valid credentials', async () => {
      const { email } = await createOperator('login')
      const result = await auth.login(email, password)

      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(result.permissions.length).toBeGreaterThan(0)
    })

    it('rejects a wrong password and an unknown email with the same message', async () => {
      const { email } = await createOperator('generic')

      await expect(auth.login(email, 'wrong-password-entirely')).rejects.toThrow('Invalid credentials')
      await expect(auth.login('nobody@test.local', 'wrong-password-entirely')).rejects.toThrow('Invalid credentials')
    })
  })

  describe('sessions', () => {
    it('stores only the hash, so a database read cannot be replayed', async () => {
      const { email } = await createOperator('hashed')
      const { token } = await auth.login(email, password)

      const stored = await prisma.session.findMany({ select: { token_hash: true } })
      expect(stored.some(s => s.token_hash === token)).toBe(false)
      expect(stored.some(s => s.token_hash === tokens.hash(token))).toBe(true)
    })

    it('resolves a valid session without extending its expiry', async () => {
      const { email } = await createOperator('noextend')
      const { token, expiresAt } = await auth.login(email, password)

      const first = await auth.introspect(token)
      const second = await auth.introspect(token)

      expect(first.valid).toBe(true)
      expect(second.valid).toBe(true)
      if (first.valid && second.valid) {
        expect(first.expiresAt.getTime()).toBe(expiresAt.getTime())
        expect(second.expiresAt.getTime()).toBe(expiresAt.getTime())
      }
    })

    it('rejects an unknown token', async () => {
      const result = await auth.introspect(tokens.generate())

      expect(result).toEqual({ valid: false, reason: 'unknown' })
    })

    it('reports an expired session as expired rather than unknown', async () => {
      const { email, user } = await createOperator('expired')
      const { token } = await auth.login(email, password)

      await prisma.session.updateMany({
        where: { user_id: user.id },
        data: { expires_at: new Date(Date.now() - 1000) },
      })

      expect(await auth.introspect(token)).toEqual({ valid: false, reason: 'expired' })
    })

    it('revokes immediately on logout, with no grace period', async () => {
      const { email } = await createOperator('logout')
      const { token } = await auth.login(email, password)

      await auth.logout(token)

      expect((await auth.introspect(token)).valid).toBe(false)
    })

    it('revokes every session when the account is deactivated', async () => {
      const { email, user } = await createOperator('deactivate')
      const first = await auth.login(email, password)
      const second = await auth.login(email, password)

      await users.setActive(user.id, false)

      expect((await auth.introspect(first.token)).valid).toBe(false)
      expect((await auth.introspect(second.token)).valid).toBe(false)
    })
  })

  describe('permissions', () => {
    it('reflects a role change on the next introspection, without a re-login', async () => {
      const { email, user } = await createOperator('rolechange')
      const { token } = await auth.login(email, password)

      const before = await auth.introspect(token)
      await users.setRoles(user.id, ['administrator'])
      const after = await auth.introspect(token)

      expect(before.valid && after.valid).toBe(true)
      if (before.valid && after.valid) {
        expect(after.permissions.length).toBeGreaterThan(before.permissions.length)
      }
    })

    it('authenticates a user with no roles but authorizes them for nothing', async () => {
      const email = uniqueEmail('noroles')
      const created = await users.create(email, 'No Roles', password, ['operator'])
      await users.setRoles(created.id, [])

      const result = await auth.login(email, password)

      expect(result.permissions).toEqual([])
    })
  })

  describe('throttling', () => {
    it('rejects further attempts once the threshold is passed, even with the right password', async () => {
      const { email } = await createOperator('throttle')
      const maxAttempts = 5

      for (let i = 0; i < maxAttempts; i += 1) {
        await expect(auth.login(email, 'wrong-password-entirely')).rejects.toThrow()
      }

      // The correct credential is now refused for the cooling-off window.
      await expect(auth.login(email, password)).rejects.toThrow('Invalid credentials')
    })

    it('clears on its own once the window elapses, with no administrator action', async () => {
      const { email, user } = await createOperator('throttle-clear')

      for (let i = 0; i < 5; i += 1) {
        await expect(auth.login(email, 'wrong-password-entirely')).rejects.toThrow()
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { throttled_until: new Date(Date.now() - 1000) },
      })

      await expect(auth.login(email, password)).resolves.toHaveProperty('token')
    })
  })
})
