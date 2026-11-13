const { createLogger, createTelemetry, validateTelemetryConfig } = require('@rusuh/observability');
const { loadEnvironment } = require('@/infrastructure/config/environment');

/**
 * Loads configuration and starts telemetry. Must be required before `http`,
 * `express`, or any module that imports them: OpenTelemetry can only patch
 * modules loaded after the instrumentation is registered, so moving this
 * require below them silently disables all spans.
 */
const config = loadEnvironment();
const logger = createLogger({
  service: 'core',
  environment: config.nodeEnv,
  instanceId: config.observability.serviceInstanceId,
  format: config.observability.logFormat
});
const telemetryConfig = {
  ...config.observability,
  serviceName: 'core',
  environment: config.nodeEnv,
  instanceId: config.observability.serviceInstanceId,
  logger
};
validateTelemetryConfig(telemetryConfig);
const telemetry = createTelemetry(telemetryConfig);

module.exports = { config, logger, telemetry };
