import { GatewayError } from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from './gateway-error-key';

const failure = (
  init: Partial<ConstructorParameters<typeof GatewayError>[0]>
) => new GatewayError({ code: '', status: 500, correlationId: '', ...init });

describe('gatewayErrorKey', () => {
  it('reads the code the contract promises', () => {
    expect(gatewayErrorKey(failure({ code: 'not_found' }))).toBe(
      'resource.error.notFound'
    );
    expect(gatewayErrorKey(failure({ code: 'forbidden' }))).toBe(
      'resource.error.forbidden'
    );
    expect(gatewayErrorKey(failure({ code: 'conflict' }))).toBe(
      'resource.error.conflict'
    );
    expect(gatewayErrorKey(failure({ code: 'validation_failed' }))).toBe(
      'resource.error.validation'
    );
  });

  /**
   * A body that did not reach this app intact is what a proxy answering instead
   * of the gateway looks like, and the status is all that survives it.
   */
  it('falls back to the status when there is no code', () => {
    expect(gatewayErrorKey(failure({ status: 404 }))).toBe(
      'resource.error.notFound'
    );
    expect(gatewayErrorKey(failure({ status: 403 }))).toBe(
      'resource.error.forbidden'
    );
    expect(gatewayErrorKey(failure({ status: 409 }))).toBe(
      'resource.error.conflict'
    );
  });

  /**
   * The one failure an operator can usually fix themselves, so it is worth its
   * own sentence rather than being folded into "something went wrong".
   */
  it('names a request that produced no response at all', () => {
    expect(gatewayErrorKey(failure({ status: 0 }))).toBe(
      'resource.error.unreachable'
    );
  });

  it('is total: anything unanticipated still reaches the screen as a sentence', () => {
    expect(gatewayErrorKey(failure({ status: 500 }))).toBe(
      'resource.error.unknown'
    );
    expect(gatewayErrorKey(failure({ code: 'teapot', status: 418 }))).toBe(
      'resource.error.unknown'
    );
    expect(gatewayErrorKey(null)).toBe('resource.error.unknown');
  });
});
