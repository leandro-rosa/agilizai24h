import type { PrismaClientService } from '../../src/modules/db-client/prisma-client.service'

/**
 * Empties every table of the DISPOSABLE test database so each spec starts from
 * a known state. Refuses to run against anything that looks like the
 * operator's real database: the integration suites must only ever be run
 * through a throwaway Postgres (see the CLAUDE.md "Testes" section).
 */
export async function resetDisposableDb(prisma: PrismaClientService): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''

  if (/agiliz-intelligence-postgres|\/intelligence(\?|$)/.test(url)) {
    throw new Error('Refusing to reset what looks like the real intelligence database — run the integration tests on a disposable Postgres')
  }

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE backtest_result, backtest_run, recommendation, engine_run, product_store_flag, store_schedule, baseline_quantity, parameter_version RESTART IDENTITY CASCADE',
  )
}
