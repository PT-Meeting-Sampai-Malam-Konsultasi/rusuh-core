const { email } = require('../schemas');

describe('schemas', () => {
  it('accepts a valid email', () => {
    expect(email.validate('user@example.id').error).toBeUndefined();
    expect(email.validate('not-an-email').error).toBeDefined();
  });
});
