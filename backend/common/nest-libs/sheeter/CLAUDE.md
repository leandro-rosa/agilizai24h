# common/nest-libs/sheeter

`SheeterModule` (global) provides three services for reading/writing
spreadsheets and CSVs, all built on `HoldItBullMQBroker` and `S3Service`
for anything that needs a queue or persistence. Not imported by any app
today — no current consumer (no apps exist under `backend/apps` yet).

## Public API

- `SheeterProcessorService.smartChunk({ filePath | fileStream, requestId,
  queueCallbackName, headersRow?, additionalData? })` — reads an uploaded
  spreadsheet (from a path or a stream; `.xlsx` via `exceljs`, with a
  fallback to `xlsx`/SheetJS for legacy formats), maps each row against its
  sheet's header row(s), and enqueues the parsed rows in batches of 1200 as
  BullMQ jobs via `HoldItBullMQBroker.holdIt`/`holdItALot`. Guards against
  unreadable files and Excel's `~$file.xlsx` temp lock files before reading.
  This is the closest existing building block to the spreadsheet-parsing
  step a planned quote-upload flow still needs — column-mapping rules are
  still unconfirmed, so nothing wires the two together yet, and no such app
  exists under `backend/apps` in this repo.
- `XlsWriterService` / `CsvWriterService` — write `.xlsx` (via `exceljs`,
  streaming `WorkbookWriter`) or `.csv` (via the `csv-writer` package),
  append-or-create at a given `filePath`, then upload to S3 through
  `S3Service.uploadFile`.

## Consumers

None yet — no app exists under `backend/apps` in this repo. This lib
predates any consuming app.
