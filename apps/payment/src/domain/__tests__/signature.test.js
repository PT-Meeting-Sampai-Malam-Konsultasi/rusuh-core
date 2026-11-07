const crypto = require('crypto');
const { computeSignatureKey, verifySignatureKey } = require('../signature');

const SERVER_KEY = 'test-server-key';

describe('computeSignatureKey', () => {
  it('computes SHA512(order_id + status_code + gross_amount + serverKey)', () => {
    const expected = crypto.createHash('sha512').update('bk_01-12001505000.00test-server-key', 'utf8').digest('hex');
    expect(
      computeSignatureKey({ orderId: 'bk_01-1', statusCode: '200', grossAmount: '1505000.00', serverKey: SERVER_KEY })
    ).toBe(expected);
  });
});

describe('verifySignatureKey', () => {
  const valid = computeSignatureKey({
    orderId: 'bk_01-1',
    statusCode: '200',
    grossAmount: '1505000.00',
    serverKey: SERVER_KEY
  });

  it('accepts a correct signature', () => {
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: SERVER_KEY,
        signatureKey: valid
      })
    ).toBe(true);
  });

  it('rejects a wrong signature, wrong amount, wrong order and wrong key', () => {
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: SERVER_KEY,
        signatureKey: '0'.repeat(128)
      })
    ).toBe(false);
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505001.00',
        serverKey: SERVER_KEY,
        signatureKey: valid
      })
    ).toBe(false);
    expect(
      verifySignatureKey({
        orderId: 'bk_01-2',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: SERVER_KEY,
        signatureKey: valid
      })
    ).toBe(false);
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: 'other-key',
        signatureKey: valid
      })
    ).toBe(false);
  });

  it('rejects an empty or missing signature', () => {
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: SERVER_KEY,
        signatureKey: ''
      })
    ).toBe(false);
    expect(
      verifySignatureKey({ orderId: 'bk_01-1', statusCode: '200', grossAmount: '1505000.00', serverKey: SERVER_KEY })
    ).toBe(false);
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: SERVER_KEY,
        signatureKey: 12345
      })
    ).toBe(false);
  });

  it('rejects an empty or missing server key', () => {
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: '',
        signatureKey: valid
      })
    ).toBe(false);
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: undefined,
        signatureKey: valid
      })
    ).toBe(false);
  });

  it('rejects a signature whose length differs from the expected one', () => {
    expect(
      verifySignatureKey({
        orderId: 'bk_01-1',
        statusCode: '200',
        grossAmount: '1505000.00',
        serverKey: SERVER_KEY,
        signatureKey: 'abc'
      })
    ).toBe(false);
  });
});
