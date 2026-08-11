# common/nest-libs/aws

`AwsModule` (global) provides a single `S3Service` wired to the AWS SDK v3
S3 client, configured from `AWS_REGION` / `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` / `AWS_S3_ENDPOINT` / `AWS_S3_FORCE_PATH_STYLE`
(useful for S3-compatible endpoints like MinIO in local dev).

## Public API

- `S3Service.uploadFile(key, body, contentType, options?)` — `options.connection`
  lets a caller override credentials/region/endpoint per call instead of
  using the module-level default client; `options.bucket` overrides
  `AWS_S3_BUCKET`.
- `S3Service.getFile(key, options?)` — downloads an object, buffered fully
  into memory (`{ body: Buffer, contentType? }`). Planned first consumer: a
  quote-upload worker reading back an uploaded spreadsheet to parse it (see
  `sheeter`'s `SheeterProcessorService` for the closest existing building
  block) — no such app exists in this repo yet.

## Consumers

`common/nest-libs/sheeter`'s `CsvWriterService` (upload generated CSVs). A
planned quote-upload flow (upload + read back the original spreadsheet, via
a LocalStack-backed `AWS_S3_ENDPOINT` in local dev) — not yet built under
`backend/apps` (empty today).

## Known gaps

- `s3/index.ts` still imports `DeleteObjectCommand`/`ListObjectsV2Command`
  and their `*Output` types without using them — `uploadFile`/`getFile` are
  the only operations implemented; delete/list remain unfinished
  scaffolding. Not resolved here.

## Fixed: `AWS_S3_FORCE_PATH_STYLE` silently ignored when set via env

`ConfigService.get<boolean>(...)` does not parse strings into real
booleans — it only casts the generic type, so `AWS_S3_FORCE_PATH_STYLE=true`
stayed the string `"true"` at runtime. The AWS SDK's bucket-endpoint
middleware does a strict `=== true` check on `forcePathStyle`, so that
truthy-but-non-boolean string silently fell through to virtual-hosted-style
addressing (`{bucket}.{host}`) instead of path-style (`{host}/{bucket}`) —
fatal against an S3-compatible endpoint like LocalStack, whose DNS only
resolves the plain host (surfaced as `getaddrinfo ENOTFOUND
{bucket}.{host}}` when a quote app's upload flow was wired to LocalStack in
an earlier iteration of this system, not present in this repo).
Fixed by routing both `aws.module.ts` and `s3/index.ts` through the new
`parseForcePathStyle()` export instead of relying on `ConfigService`'s
unchecked cast.
