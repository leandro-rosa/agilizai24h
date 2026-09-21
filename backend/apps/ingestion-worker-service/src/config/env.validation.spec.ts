import { validateEnv } from './env.validation'

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5438/ingestion_test',
  REDIS_QUEUE_HOST: '127.0.0.1',
  REDIS_QUEUE_PORT: '6379',
  WITH_KAFKA_BROKERS: 'false',
  STORES_SERVICE_URL: 'http://stores',
  PRODUCTS_SERVICE_URL: 'http://products',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'k',
  AWS_SECRET_ACCESS_KEY: 's',
  AWS_S3_BUCKET: 'bucket',
}

const serviceAccount = Buffer.from(
  JSON.stringify({ client_email: 'reader@project.iam.gserviceaccount.com', private_key: 'not-a-real-key' }),
).toString('base64')

describe('validateEnv — Drive source', () => {
  it('starts unconfigured: none of the Drive variables is required', () => {
    expect(() => validateEnv(baseEnv)).not.toThrow()
  })

  it('starts fully configured', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        GOOGLE_DRIVE_ROOT_FOLDER_ID: 'folder-id',
        GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount,
      }),
    ).not.toThrow()
  })

  it('fails naming the missing credential when only the root folder is set', () => {
    expect(() => validateEnv({ ...baseEnv, GOOGLE_DRIVE_ROOT_FOLDER_ID: 'folder-id' })).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_SERVICE_ACCOUNT_FILE/,
    )
  })

  it('reads a raised size limit as configured without failing', () => {
    expect(() => validateEnv({ ...baseEnv, DRIVE_MAX_FILE_BYTES: String(40 * 1024 * 1024) })).not.toThrow()
  })

  it('fails on an unusable threshold, naming the variable', () => {
    expect(() => validateEnv({ ...baseEnv, DRIVE_COVERAGE_MIN_STORE: '2' })).toThrow(/DRIVE_COVERAGE_MIN_STORE/)
  })
})
