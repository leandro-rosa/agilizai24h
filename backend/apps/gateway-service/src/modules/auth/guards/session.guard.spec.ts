import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { SessionGuard } from './session.guard'
import { SESSION_COOKIE } from './session.constants'

const contextFor = (request: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as never

describe('SessionGuard', () => {
  const caller = { id: 1, email: 'a@b.c', name: 'A', roles: ['operator'], permissions: ['stores:read'] }

  const build = (opts: { resolve?: jest.Mock; isPublic?: boolean; required?: string }) => {
    const sessions = { resolve: opts.resolve ?? jest.fn().mockResolvedValue(caller) }
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => (key === 'gateway:isPublic' ? opts.isPublic : opts.required)),
    }
    return { guard: new SessionGuard(sessions as never, reflector as never), sessions }
  }

  it('lets a public route through without a session', async () => {
    const { guard, sessions } = build({ isPublic: true })

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true)
    expect(sessions.resolve).not.toHaveBeenCalled()
  })

  it('rejects a missing session without troubling the identity service', async () => {
    const { guard, sessions } = build({})

    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toBeInstanceOf(UnauthorizedException)
    expect(sessions.resolve).not.toHaveBeenCalled()
  })

  it('allows a caller holding the required permission', async () => {
    const { guard } = build({ required: 'stores:read' })

    await expect(guard.canActivate(contextFor({ cookies: { [SESSION_COOKIE]: 't' } }))).resolves.toBe(true)
  })

  it('rejects a caller lacking the permission as forbidden, not unauthenticated', async () => {
    // The panel must show "not permitted" rather than sending them to login.
    const { guard } = build({ required: 'stores:write' })

    await expect(guard.canActivate(contextFor({ cookies: { [SESSION_COOKIE]: 't' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('attaches the resolved caller to the request', async () => {
    const { guard } = build({ required: 'stores:read' })
    const request: Record<string, unknown> = { cookies: { [SESSION_COOKIE]: 't' } }

    await guard.canActivate(contextFor(request))

    expect(request.caller).toEqual(caller)
  })

  it('propagates a 503 from the session service rather than converting it', async () => {
    const failure = new Error('unavailable')
    const { guard } = build({ resolve: jest.fn().mockRejectedValue(failure), required: 'stores:read' })

    await expect(guard.canActivate(contextFor({ cookies: { [SESSION_COOKIE]: 't' } }))).rejects.toBe(failure)
  })
})

describe('SessionGuard public paths', () => {
  const build = () => {
    const sessions = { resolve: jest.fn() }
    const reflector = { getAllAndOverride: jest.fn(() => undefined) }
    return { guard: new SessionGuard(sessions as never, reflector as never), sessions }
  }

  const ctx = (url: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ url, cookies: {} }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as never

  it.each(['/health', '/docs', '/docs-json'])('leaves %s reachable without a session', async url => {
    // @app/health's controller cannot carry @Public(), so without a path
    // exemption the global guard puts liveness behind auth and the container
    // reports itself unhealthy forever.
    const { guard, sessions } = build()

    await expect(guard.canActivate(ctx(url))).resolves.toBe(true)
    expect(sessions.resolve).not.toHaveBeenCalled()
  })

  it('still protects a route that merely starts with similar text', async () => {
    const { guard } = build()

    await expect(guard.canActivate(ctx('/healthcheck-secrets'))).rejects.toThrow()
  })
})
