/** Unit tier: colocated *.spec.ts, no I/O, no Nest DI. */
const libs = ['aws', 'elasticsearch', 'health', 'hold-it', 'http-client', 'prisma-db-client']
const contracts = ['iam-contracts', 'products-contracts', 'ingestion-contracts']

// Two patterns per lib, mirroring backend/tsconfig.json: hold-it imports its
// siblings by subpath (e.g. @app/elasticsearch/services/client), so a bare
// mapping alone leaves those unresolved.
const moduleNameMapper = {}
for (const name of [...libs, ...contracts]) {
  moduleNameMapper[`^@app/${name}$`] = `<rootDir>/../../common/nest-libs/${name}/src`
  moduleNameMapper[`^@app/${name}/(.*)$`] = `<rootDir>/../../common/nest-libs/${name}/src/$1`
}

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  moduleNameMapper,
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.app.json' }] },
}
