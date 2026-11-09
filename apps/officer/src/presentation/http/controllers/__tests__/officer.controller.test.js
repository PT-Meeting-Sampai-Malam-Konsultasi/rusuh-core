const { apiError } = require('@/domain/errors');
const { createOfficerController } = require('../officer.controller');

function makeResponse() {
  const response = {
    locals: {},
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  return response;
}

describe('createOfficerController', () => {
  it('lookup returns the ticket view', async () => {
    const ticket = { ticketId: 'tk_1', ticketCode: 'SMD-FB-04827' };
    const useCase = { lookupTicket: jest.fn().mockResolvedValue(ticket) };
    const controller = createOfficerController(useCase);
    const response = makeResponse();
    const next = jest.fn();
    await controller.lookup({ params: { ticketId: 'tk_1' } }, response, next);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(ticket);
    expect(response.locals.skipResponseEnvelope).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('lookup forwards a use-case error to next', async () => {
    const useCase = { lookupTicket: jest.fn().mockRejectedValue(apiError('TICKET_NOT_FOUND', 'gone')) };
    const controller = createOfficerController(useCase);
    const next = jest.fn();
    await controller.lookup({ params: { ticketId: 'tk_nope' } }, makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].data.code).toBe('TICKET_NOT_FOUND');
  });

  it('scan forwards a use-case error to next', async () => {
    const useCase = { scanTicket: jest.fn().mockRejectedValue(apiError('TICKET_NOT_VALID', 'wrong day')) };
    const controller = createOfficerController(useCase);
    const response = makeResponse();
    const next = jest.fn();
    await controller.scan(
      { params: { ticketId: 'tk_1' }, body: { gate: 'Gerbang 5' }, account: { id: 'acc_officer_1' } },
      response,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].data.code).toBe('TICKET_NOT_VALID');
    expect(useCase.scanTicket).toHaveBeenCalledWith('tk_1', { officerId: 'acc_officer_1', gate: 'Gerbang 5' });
  });

  it('scan works without a gate in the body', async () => {
    const ticket = { ticketId: 'tk_1', nikFull: '3171010101900001' };
    const useCase = { scanTicket: jest.fn().mockResolvedValue(ticket) };
    const controller = createOfficerController(useCase);
    const response = makeResponse();
    await controller.scan(
      { params: { ticketId: 'tk_1' }, body: {}, account: { id: 'acc_officer_1' } },
      response,
      jest.fn()
    );
    expect(response.statusCode).toBe(200);
    expect(useCase.scanTicket).toHaveBeenCalledWith('tk_1', { officerId: 'acc_officer_1', gate: undefined });
  });

  it('scan forwards a validation error to next', async () => {
    const useCase = { scanTicket: jest.fn() };
    const controller = createOfficerController(useCase);
    const next = jest.fn();
    await controller.scan(
      { params: { ticketId: '' }, body: {}, account: { id: 'acc_officer_1' } },
      makeResponse(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].data.code).toBe('VALIDATION_FAILED');
    expect(useCase.scanTicket).not.toHaveBeenCalled();
  });

  it('listAttendees forwards a use-case error to next', async () => {
    const useCase = { listAttendees: jest.fn().mockRejectedValue(apiError('NOT_FOUND', 'no event')) };
    const controller = createOfficerController(useCase);
    const next = jest.fn();
    await controller.listAttendees({ params: { eventId: 'evt_nope' }, query: {} }, makeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].data.code).toBe('NOT_FOUND');
  });
});
