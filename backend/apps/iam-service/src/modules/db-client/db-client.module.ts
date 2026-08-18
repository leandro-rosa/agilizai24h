import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { POSTGRES_HEALTH_CLIENT } from '@app/health'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClientService } from './prisma-client.service'
import { PermissionRepository } from './repositories/permission.repository'
import { RoleRepository } from './repositories/role.repository'
import { SessionRepository } from './repositories/session.repository'
import { UserRepository } from './repositories/user.repository'

const repositories = [UserRepository, SessionRepository, RoleRepository, PermissionRepository]

/**
 * Global because every feature module needs a repository or the client itself,
 * and re-importing this everywhere would add nothing.
 *
 * Binding POSTGRES_HEALTH_CLIENT here is what lets @app/health's Postgres
 * indicator work without that lib knowing anything about Prisma.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaPg,
      useFactory: (config: ConfigService) => new PrismaPg({ connectionString: config.getOrThrow<string>('DATABASE_URL') }),
      inject: [ConfigService],
    },
    PrismaClientService,
    ...repositories,
    { provide: POSTGRES_HEALTH_CLIENT, useExisting: PrismaClientService },
  ],
  exports: [PrismaClientService, ...repositories, POSTGRES_HEALTH_CLIENT],
})
export class DbClientModule {}
