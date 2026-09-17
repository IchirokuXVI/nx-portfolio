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
   * The two the brands registry adds (backend plan 0115, section 5.3).
   *
   * Named apart from the generic conflict and the generic validation sentence,
   * because each names the fix: type a letter, or open the brand that already
   * holds the key.
   */
  it('names both ways a brand can be refused', () => {
    expect(gatewayErrorKey(failure({ code: 'brand_label_empty' }))).toBe(
      'resource.error.brandLabelEmpty'
    );
    expect(gatewayErrorKey(failure({ code: 'brand_key_taken' }))).toBe(
      'resource.error.brandKeyTaken'
    );
  });

  /**
   * The five a link between brands adds (backend plan 0124).
   *
   * Each is its own sentence rather than the generic conflict, because each
   * names a different fix: unlink first, set the chain on the brand it spells,
   * register the other spelling, or leave the name alone.
   */
  it('names every way a brand link can be refused', () => {
    expect(gatewayErrorKey(failure({ code: 'brand_link_to_self' }))).toBe(
      'resource.error.brandLinkToSelf'
    );
    expect(gatewayErrorKey(failure({ code: 'brand_link_too_deep' }))).toBe(
      'resource.error.brandLinkTooDeep'
    );
    expect(gatewayErrorKey(failure({ code: 'brand_link_owns_no_chain' }))).toBe(
      'resource.error.brandLinkOwnsNoChain'
    );
    expect(gatewayErrorKey(failure({ code: 'brand_link_keeps_key' }))).toBe(
      'resource.error.brandLinkKeepsKey'
    );
    expect(gatewayErrorKey(failure({ code: 'brand_not_linked' }))).toBe(
      'resource.error.brandNotLinked'
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
  });

  /**
   * The state where nothing went wrong is not the unknown failure.
   *
   * Every screen guards this key on truthiness, so a sentence here for no error
   * at all drew "That did not work, and the server did not say why" over four
   * working screens. A caller that has lost the type of a failure it already
   * has says `?? 'resource.error.unknown'` at its own call site.
   */
  it('has no sentence for no failure', () => {
    expect(gatewayErrorKey(null)).toBeNull();
  });
});
