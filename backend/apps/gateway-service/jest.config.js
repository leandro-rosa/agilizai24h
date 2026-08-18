/** Unit tier: colocated *.spec.ts, no I/O, no Nest DI. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@app/iam-contracts$': '<rootDir>/../../common/nest-libs/iam-contracts/src',
    '^@app/products-contracts$': '<rootDir>/../../common/nest-libs/products-contracts/src',
    '^@app/health$': '<rootDir>/../../common/nest-libs/health/src',
    '^@app/http-client$': '<rootDir>/../../common/nest-libs/http-client/src',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.app.json' }] },
}
