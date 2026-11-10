const { midtransNotificationSchema } = require('../webhook.validation');
const { notification } = require('../../../../application/webhook/__tests__/webhook-test-harness');

describe('midtransNotificationSchema', () => {
  it('accepts a valid Midtrans notification', () => {
    const { error } = midtransNotificationSchema.validate(notification());
    expect(error).toBeUndefined();
  });

  it('rejects a notification missing required fields', () => {
    const { error } = midtransNotificationSchema.validate({ order_id: 'bk_01-1' });
    expect(error).toBeDefined();
  });

  it('rejects an unknown transaction_status', () => {
    const { error } = midtransNotificationSchema.validate(notification({ transaction_status: 'unknown' }));
    expect(error).toBeDefined();
  });

  it('accepts capture with a fraud_status', () => {
    const { error } = midtransNotificationSchema.validate(
      notification({ transaction_status: 'capture', fraud_status: 'challenge' })
    );
    expect(error).toBeUndefined();
  });
});
