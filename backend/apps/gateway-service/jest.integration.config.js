/** Integration tier: runs against the real Postgres from docker-compose. */
const base = require('./jest.config')

module.exports = {
  ...base,
  testRegex: 'test/.*\\.integration-spec\\.ts$',
  testTimeout: 30000,
  // The stub server and Fastify both close cleanly, but @app/http-client's
  // axios agent keeps a socket pool alive briefly; without this Jest hangs a
  // second after a green run.
  forceExit: true,
  detectOpenHandles: false,
}
