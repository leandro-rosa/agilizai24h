import { createHash, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'

/**
 * Session tokens are opaque: 256 bits of randomness carrying no user data, so
 * nothing can be derived from one without asking this service.
 *
 * Only the hash is persisted. A database read therefore cannot be replayed as
 * a valid session.
 */
@Injectable()
export class SessionTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url')
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
