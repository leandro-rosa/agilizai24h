/** Unit tier: colocated *.spec.ts, no I/O, no Nest DI. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@app/health$': '<rootDir>/../../common/nest-libs/health/src',
    '^@app/prisma-db-client$': '<rootDir>/../../common/nest-libs/prisma-db-client/src',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.app.json' }] },
}
