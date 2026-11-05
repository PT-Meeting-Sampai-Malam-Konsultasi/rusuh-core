/**
 * In-memory OTP mailer: records the OTP jobs that would be sent to SQS.
 * Used for tests and for running without AWS. `failNext()` makes the next
 * send throw, to exercise the 503 path (LLD-01 §7).
 */
function createMemoryMailer() {
  const sent = [];
  let failNext = false;

  return {
    /** All OTP jobs recorded so far (for tests). */
    sent,

    /** Makes the next sendOtp() throw (test helper). */
    failNext() {
      failNext = true;
    },

    async sendOtp({ to, code, locale }) {
      if (failNext) {
        failNext = false;
        throw new Error('Mailer unavailable (simulated)');
      }
      sent.push({ to, template: 'otp', code, locale: locale || 'id', sentAt: new Date() });
    },

    async close() {
      // nothing to close
    }
  };
}

module.exports = { createMemoryMailer };
