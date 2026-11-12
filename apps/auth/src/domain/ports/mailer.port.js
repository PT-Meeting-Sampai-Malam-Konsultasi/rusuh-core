/**
 * Mailer port — the OTP delivery contract the OTP use case depends on.
 * Implemented by infrastructure/messaging (SQS or in-memory).
 * The OTP code is in the job (transient) and is NEVER written to logs.
 *
 * @typedef {object} Mailer
 * @property {function({to: string, code: string, locale: string, expiresAt: Date, validFor: string}): Promise<void>} sendOtp - Delivers an OTP code to an email (expiresAt pre-formats the e-mail clock time; validFor is the pre-formatted validity phrase, e.g. "5 menit").
 * @property {function(): Promise<void>} close - Releases the mailer (client destroy / no-op).
 */

module.exports = {};
