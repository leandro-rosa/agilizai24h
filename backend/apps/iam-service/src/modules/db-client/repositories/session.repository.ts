import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Session } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../prisma-client.service'

@Injectable()
export class SessionRepository extends PrismaRepository<Session, Session> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.session, 'Session')
  }

  /**
   * Resolves a session together with the owner's roles and permissions. Single
   * indexed read on token_hash — this is the gateway's per-request call.
   */
  findByTokenHashWithUser(tokenHash: string) {
    return this.prismaClient.session.findUnique({
      where: { token_hash: tokenHash },
      include: {
        user: {
          include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
        },
      },
    })
  }

  /** Revokes every live session for a user — used when an account is deactivated. */
  revokeAllForUser(userId: number, now: Date) {
    return this.prismaClient.session.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: now },
    })
  }
}
