/**
 * Creates the first administrator on an empty database.
 *
 * Run it as a one-off command, not as part of boot:
 *
 *   IAM_BOOTSTRAP_EMAIL=... IAM_BOOTSTRAP_PASSWORD=... \
 *     node -r ./register-paths.js dist/apps/iam-service/src/bootstrap-admin.js
 *
 * The password is supplied as input rather than seeded in a migration on
 * purpose: a seeded credential ends up committed, reused across environments,
 * and awkward to rotate. This leaves no default password behind.
 *
 * Idempotent — if any account already exists it changes nothing and says so,
 * so re-running it during a deploy is harmless.
 */
import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { ROLES } from '@app/iam-contracts'
import { AppModule } from './app.module'
import { UsersService } from './modules/users/services/users.service'
import { PrismaClientService } from './modules/db-client/prisma-client.service'

async function bootstrapAdmin(): Promise<void> {
  const logger = new Logger('BootstrapAdmin')
  const email = process.env.IAM_BOOTSTRAP_EMAIL
  const password = process.env.IAM_BOOTSTRAP_PASSWORD
  const name = process.env.IAM_BOOTSTRAP_NAME ?? 'Administrator'

  if (!email || !password) {
    logger.error('IAM_BOOTSTRAP_EMAIL and IAM_BOOTSTRAP_PASSWORD are required')
    process.exitCode = 1
    return
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] })

  try {
    const prisma = app.get(PrismaClientService)
    const existing = await prisma.user.count()

    if (existing > 0) {
      logger.log(`Already bootstrapped: ${existing} account(s) exist. No changes made.`)
      return
    }

    const created = await app.get(UsersService).create(email, name, password, [ROLES.ADMINISTRATOR])
    logger.log(`Created administrator ${created.email} (id ${created.id}) with ${created.permissions.length} permissions`)
  } finally {
    await app.close()
  }
}

void bootstrapAdmin()
