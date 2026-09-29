import { RpcException } from '@nestjs/microservices';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import { errorCodeOf } from './remote-problem';

/**
 * The shapes a rejected NATS call arrives in, pinned so a controller branching
 * on a service's code (the catalog read at one shop, plan 0170, is one) reads
 * the envelope where the transport really puts it.
 */
describe('errorCodeOf', () => {
  const envelope = {
    status: 404,
    code: ERROR_CODES.NOT_FOUND,
    message: 'Supermarket location not found',
    correlationId: 'corr-1',
  };

  it('reads the envelope nested under error, as the NATS client rejects', () => {
    // A service's filter throws an RpcException around the envelope, and the
    // transport serializes that exception as it stands: its `error` field and
    // its `message`. JSON is the wire, so the round trip here is the real one.
    const onTheWire: unknown = JSON.parse(
      JSON.stringify(new RpcException(envelope))
    );

    expect(onTheWire).toEqual({ error: envelope, message: envelope.message });
    expect(errorCodeOf(onTheWire)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('reads a bare envelope, as an in process double rejects', () => {
    expect(errorCodeOf(envelope)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('answers internal for a code outside the stable set', () => {
    expect(errorCodeOf({ error: { code: 'made_up' } })).toBe(
      ERROR_CODES.INTERNAL
    );
  });

  it('answers internal for something that is not an envelope at all', () => {
    expect(errorCodeOf(new Error('socket closed'))).toBe(ERROR_CODES.INTERNAL);
    expect(errorCodeOf(undefined)).toBe(ERROR_CODES.INTERNAL);
  });
});
