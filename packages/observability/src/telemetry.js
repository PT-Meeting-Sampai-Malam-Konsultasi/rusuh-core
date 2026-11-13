const { NodeSDK } = require('@opentelemetry/sdk-node');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { ParentBasedSampler, AlwaysOnSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

const TRACE_EXPORTERS = new Set(['none', 'otlp']);
const SAMPLERS = new Set(['parentbased_always_on', 'parentbased_traceidratio']);

/**
 * Validates telemetry configuration before a service starts accepting traffic.
 *
 * @param {object} config - Normalized telemetry configuration.
 * @returns {object} Validated configuration.
 * @throws {Error} When an option cannot be safely interpreted.
 */
function validateTelemetryConfig(config) {
  if (!TRACE_EXPORTERS.has(config.tracesExporter)) throw new Error('Invalid OTEL_TRACES_EXPORTER');
  if (!SAMPLERS.has(config.sampler)) throw new Error('Invalid OTEL_TRACES_SAMPLER');
  if (!Number.isFinite(config.samplerArg) || config.samplerArg < 0 || config.samplerArg > 1) {
    throw new Error('Invalid OTEL_TRACES_SAMPLER_ARG');
  }
  if (config.tracesExporter === 'otlp') {
    try {
      // URL constructor validates syntax without issuing a network request.
      const parsedEndpoint = new URL(config.endpoint);
      if (!parsedEndpoint.protocol.startsWith('http')) throw new Error('Invalid OTEL_ENDPOINT');
    } catch {
      throw new Error('Invalid OTEL_ENDPOINT');
    }
  }
  return config;
}

/**
 * Starts HTTP and Express tracing or returns a deterministic no-op lifecycle.
 *
 * @param {object} config - Validated telemetry configuration.
 * @returns {{shutdown: () => Promise<void>}} Telemetry lifecycle.
 */
function createTelemetry(config) {
  validateTelemetryConfig(config);
  if (config.tracesExporter === 'none') return { shutdown: async () => {} };
  try {
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        'service.name': config.serviceName,
        'deployment.environment.name': config.environment,
        ...(config.instanceId ? { 'service.instance.id': config.instanceId } : {})
      }),
      traceExporter: new OTLPTraceExporter({ url: `${config.endpoint.replace(/\/$/, '')}/v1/traces` }),
      sampler:
        config.sampler === 'parentbased_traceidratio'
          ? new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.samplerArg) })
          : new ParentBasedSampler({ root: new AlwaysOnSampler() }),
      // Undici covers global fetch, which HttpInstrumentation does not patch; without it
      // outbound adapter calls would not carry traceparent.
      instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new UndiciInstrumentation()]
    });
    sdk.start();
    return { shutdown: async () => sdk.shutdown() };
  } catch (error) {
    config.logger?.warn('telemetry.initialization.failed', { error: { type: error.name, message: error.message } });
    return { shutdown: async () => {} };
  }
}

module.exports = { createTelemetry, validateTelemetryConfig };
