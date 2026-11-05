const { nik, email, admissionToken, slotId } = require('../schemas');

describe('schemas', () => {
  it('accepts a 16-digit NIK', () => {
    expect(nik.validate('3171010101900001').error).toBeUndefined();
    expect(nik.validate('123').error).toBeDefined();
  });

  it('accepts a valid email', () => {
    expect(email.validate('user@example.id').error).toBeUndefined();
    expect(email.validate('not-an-email').error).toBeDefined();
  });

  it('accepts repo token formats', () => {
    expect(admissionToken.validate('adm_01JB2Y5W3N8Qm4sT7vY2xK9pL').error).toBeUndefined();
    expect(slotId.validate('s_01JB7Q9K2M').error).toBeUndefined();
  });
});
