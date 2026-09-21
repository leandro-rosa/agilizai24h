/**
 * The database an integration test may write to.
 *
 * Integration tests that create data run ONLY against a throwaway database
 * started by `test/support/with-test-db.sh` (`pnpm test:integration:drive`),
 * never against the operator's running Postgres: test and synthetic rows must
 * not share a database with real ones. This guard makes that a hard failure
 * instead of a convention — it refuses anything not clearly named as a test
 * database, and it refuses the real service's own database name outright.
 */
export function integrationDatabaseUrl(): string {
  const url = process.env.INTEGRATION_DATABASE_URL

  if (!url) {
    throw new Error(
      'INTEGRATION_DATABASE_URL is not set. Run this suite through `pnpm test:integration:drive`, ' +
        'which starts a throwaway Postgres; it never runs against the real database.',
    )
  }

  const database = new URL(url).pathname.replace(/^\//, '')

  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run: the integration database must be named *_test, got "${database}". ` +
        'Test data must never be written to a real database.',
    )
  }

  return url
}
