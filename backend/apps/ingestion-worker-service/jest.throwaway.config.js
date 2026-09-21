/**
 * Suites that CREATE data and therefore run only against a throwaway database —
 * see test/support/with-test-db.sh. Kept out of `test:integration`'s regex on
 * purpose: that tier talks to the compose Postgres, and these must never.
 */
const base = require('./jest.config')

module.exports = {
  ...base,
  testRegex: 'test/.*\\.throwaway-db-spec\\.ts$',
  testTimeout: 30000,
  forceExit: true,
}
