import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import FastifyOtelInstrumentation from '@fastify/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

/**
 * OpenTelemetry bootstrap for apps/quote (Fase 12). Loaded via `node -r`
 * BEFORE main.ts, so auto-instrumentation can patch http/pg/ioredis/fastify
 * at require() time — importing this from within main.ts would be too late
 * for modules main.ts's own dependency tree requires first.
 *
 * Runs before Nest's ConfigModule exists, so it reads process.env directly
 * instead of the validated EnvironmentVariables — see env.validation.ts.
 *
 * DB and queue visibility come from generic http/pg/ioredis instrumentation,
 * not from Prisma- or BullMQ-specific instrumentation packages: neither
 * @prisma/instrumentation's compatibility with this Prisma version nor a
 * maintained BullMQ instrumentation package is confirmed.
 */
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'

const sdk = new NodeSDK({
  resource: defaultResource().merge(
    resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'quote-api' }),
  ),
  traceExporter: new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }),
    }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Traces every fs.* call (including ones OTel's own exporters make);
      // the standard first thing to disable in every official example.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
  ],
})

sdk.start()

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0))
})
