import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { SessionService } from './session.service'
import { UpstreamUnreachableError } from '../../upstream/upstream.client'

describe('SessionService', () => {
  const build = (introspect: jest.Mock) => new SessionService({ introspect } as never)

  it('resolves a valid session into a caller with permissions', async () => {
    const service = build(
      jest.fn().mockResolvedValue({
        valid: true,
        id: 1,
        email: 'a@b.c',
        name: 'A',
        roles: ['operator'],
        permissions: ['stores:read'],
      }),
    )

    await expect(service.resolve('token')).resolves.toEqual({
      id: 1,
      email: 'a@b.c',
      name: 'A',
      roles: ['operator'],
      permissions: ['stores:read'],
    })
  })

  it('rejects an invalid session as unauthenticated', async () => {
    const service = build(jest.fn().mockResolvedValue({ valid: false, reason: 'revoked' }))

    await expect(service.resolve('token')).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('reports 503, not 401, when the identity service is unreachable', async () => {
    // The failure the whole design guards against: an IAM blip must never read
    // as a rejected session, or a dependency outage logs the company out.
    const service = build(jest.fn().mockRejectedValue(new UpstreamUnreachableError('iam', 'refused')))

    await expect(service.resolve('token')).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('reports 503 when the identity service answers unexpectedly', async () => {
    const service = build(jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } })))

    await expect(service.resolve('token')).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('does not cache — every resolve asks the identity service again', async () => {
    // iam promises immediate revocation and same-request permission changes;
    // any cache breaks both, intermittently.
    const introspect = jest
      .fn()
      .mockResolvedValueOnce({ valid: true, id: 1, email: 'a@b.c', name: 'A', permissions: ['stores:read'] })
      .mockResolvedValueOnce({ valid: false, reason: 'revoked' })

    const service = build(introspect)

    await expect(service.resolve('token')).resolves.toMatchObject({ id: 1 })
    await expect(service.resolve('token')).rejects.toBeInstanceOf(UnauthorizedException)
    expect(introspect).toHaveBeenCalledTimes(2)
  })

  it('treats an absent permission list as no permissions, never as unrestricted', async () => {
    const service = build(jest.fn().mockResolvedValue({ valid: true, id: 1, email: 'a@b.c', name: 'A' }))

    await expect(service.resolve('token')).resolves.toMatchObject({ permissions: [] })
  })
})
