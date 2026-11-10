const request = require('supertest');
const { loadEnvironment } = require('./infrastructure/config/environment');
const { createDependencies } = require('./container');
const { createApp } = require('./app');

/**
 * Builds a fresh app with in-memory adapters (no Postgres/Valkey/AWS) and
 * a fixed OTP secret, for tests.
 *
 * @returns {{app: import('express').Express, dependencies: object, config: object}}
 */
function createTestApp() {
  const config = loadEnvironment({});
  const dependencies = createDependencies({ ...config, otpSecret: 'test-otp-secret-0123456789abcdef' });
  const app = createApp({ config, dependencies });
  return { app, dependencies, config };
}

/**
 * Logs in a user via the OTP flow and returns the Session. The account is
 * created without a profile name; tests that need one call PUT /v1/auth/profile.
 *
 * @param {object} app - Express app.
 * @param {object} mailer - Memory mailer (to read the OTP code).
 * @param {string} email - Email to log in.
 * @returns {Promise<object>} Session.
 */
async function loginViaOtp(app, mailer, email) {
  const requested = await request(app).post('/v1/auth/otp').send({ email });
  if (requested.status !== 202) throw new Error(`OTP request failed: ${requested.status}`);
  const { code } = mailer.sent[mailer.sent.length - 1];
  const verified = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ challengeId: requested.body.challengeId, code });
  if (verified.status !== 200) throw new Error(`OTP verify failed: ${verified.status}`);
  return verified.body;
}

module.exports = { createTestApp, loginViaOtp };
