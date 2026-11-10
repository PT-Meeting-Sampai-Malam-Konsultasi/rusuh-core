// The ports file is JSDoc-only (no runtime code): it documents the adapter
// contracts the application layer depends on. This test pins that the file
// stays loadable (a syntax error here fails the suite at load time) and that
// it exports nothing at runtime.
const ports = require('../index');

describe('domain/ports (JSDoc contracts)', () => {
  it('loads without error and exports no runtime code', () => {
    expect(ports).toEqual({});
  });
});
