import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'

/**
 * Argon2id — memory-hard, so a leaked hash is expensive to attack on GPUs.
 * The spec requires a memory-hard algorithm rather than naming one, so this
 * choice can move without a spec change.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions & { raw?: false }

  constructor(config: ConfigService) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.get<number>('ARGON2_MEMORY_COST') ?? 19456,
      timeCost: config.get<number>('ARGON2_TIME_COST') ?? 2,
      parallelism: config.get<number>('ARGON2_PARALLELISM') ?? 1,
    }
  }

  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, this.options)
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext)
    } catch {
      // A malformed stored hash must read as "wrong password", never as a crash
      // that would distinguish this account from any other.
      return false
    }
  }

  /**
   * Burns comparable CPU to a real verify when no account exists, so an unknown
   * email cannot be told apart from a wrong password by response timing.
   */
  async dummyVerify(): Promise<void> {
    await argon2.hash('timing-equalisation', this.options)
  }
}
