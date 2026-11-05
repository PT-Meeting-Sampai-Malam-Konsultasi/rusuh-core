const { problemBody, problemError } = require('@/lib/problem');

describe('problem (RFC 9457)', () => {
  it('renders the Problem body for a known code', () => {
    const body = problemBody('NOT_FOUND', 'No such resource for this caller.');
    expect(body).toMatchObject({
      type: 'https://api.rusuh.id/problems/not-found',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'No such resource for this caller.'
    });
  });

  it('problemError returns an Error with a status and a problem body', () => {
    const error = problemError('CATEGORY_SOLD_OUT', 'No more seats in this category.');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('No more seats in this category.');
    expect(error.status).toBe(409);
    expect(error.code).toBe('CATEGORY_SOLD_OUT');
    expect(error.problem).toMatchObject({ status: 409, code: 'CATEGORY_SOLD_OUT' });
    expect(() => {
      throw problemError('CATEGORY_SOLD_OUT', 'No more seats in this category.');
    }).toThrow('No more seats in this category.');
  });

  it('falls back to a 500 status for an unknown code (code is echoed)', () => {
    const body = problemBody('SOMETHING_ELSE', 'detail');
    expect(body.status).toBe(500);
    expect(body.title).toBe('Internal Server Error');
    expect(body.code).toBe('SOMETHING_ELSE');
  });

  it('carries extra Problem members (e.g. categoryId)', () => {
    const body = problemBody('CATEGORY_SOLD_OUT', 'Pick another category.', { categoryId: 'cat_vip' });
    expect(body.categoryId).toBe('cat_vip');
  });
});
