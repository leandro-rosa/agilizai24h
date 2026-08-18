/** Integration tier: runs against the real Postgres from docker-compose. */
const base = require('./jest.config')

module.exports = {
  ...base,
  testRegex: 'test/.*\\.integration-spec\\.ts$',
  testTimeout: 30000,
}
