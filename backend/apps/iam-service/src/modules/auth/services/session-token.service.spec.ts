import { SessionTokenService } from './session-token.service'

describe('SessionTokenService', () => {
  const service = new SessionTokenService()

  it('generates a high-entropy token each time', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => service.generate()))

    expect(tokens.size).toBe(200)
  })

  it('generates a token carrying no user data', () => {
    // 32 random bytes, base64url encoded — nothing is derivable from it.
    expect(service.generate()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('hashes deterministically, and the hash is not the token', () => {
    const token = service.generate()

    expect(service.hash(token)).toBe(service.hash(token))
    expect(service.hash(token)).not.toBe(token)
  })

  it('gives different tokens different hashes', () => {
    expect(service.hash(service.generate())).not.toBe(service.hash(service.generate()))
  })
})
