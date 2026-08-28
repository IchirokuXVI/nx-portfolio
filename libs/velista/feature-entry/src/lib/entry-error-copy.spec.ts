import { GatewayError, NetworkError } from '@portfolio/velista/data-access';
import { entryErrorKey } from './entry-error-copy';

function gateway(code: GatewayError['code'], status: number): GatewayError {
  return new GatewayError({ code, status, correlationId: 'ref' });
}

/**
 * Plan 0008, section 5.4, one test per row.
 *
 * The whole point of the table is that the same code means different things on the two
 * routes, so the pairs that differ are asserted against each other rather than each in
 * isolation: a mapping that quietly collapsed to one message per code would still pass
 * half of these.
 */
describe('entryErrorKey', () => {
  describe('on a join', () => {
    it('says no group has that code for a 404', () => {
      expect(entryErrorKey(gateway('not_found', 404), 'zones.join')).toBe(
        'entry.error.noSuchZone'
      );
    });

    it('says you already asked for a 409', () => {
      // APPROVED here already, or PENDING here already. One message, because the
      // person cannot act differently on the two.
      expect(entryErrorKey(gateway('conflict', 409), 'zones.join')).toBe(
        'entry.error.alreadyAsked'
      );
    });

    it('says you cannot join for a 403, without saying why', () => {
      expect(entryErrorKey(gateway('forbidden', 403), 'zones.join')).toBe(
        'entry.error.notAllowed'
      );
    });

    it('asks for a minute on a 429', () => {
      expect(entryErrorKey(gateway('rate_limited', 429), 'zones.join')).toBe(
        'entry.error.tooMany'
      );
    });

    it('falls back to the generic sentence for a validation failure', () => {
      // Unreachable from the field, which enforces the shape before anything is sent.
      expect(
        entryErrorKey(gateway('validation_failed', 400), 'zones.join')
      ).toBe('entry.error.failed');
    });
  });

  describe('on a create', () => {
    it('blames itself for a 409, because a join code collided', () => {
      // Nothing the person did, so the copy says so and the primary stays enabled.
      expect(entryErrorKey(gateway('conflict', 409), 'zones.create')).toBe(
        'entry.error.createClash'
      );
    });

    it('reads the same 409 differently from a join', () => {
      const error = gateway('conflict', 409);

      expect(entryErrorKey(error, 'zones.create')).not.toBe(
        entryErrorKey(error, 'zones.join')
      );
    });

    it('shares the throttle message, which is about neither operation', () => {
      expect(entryErrorKey(gateway('rate_limited', 429), 'zones.create')).toBe(
        'entry.error.tooMany'
      );
    });
  });

  describe('when there is no code to key on', () => {
    it('does not claim to know why a request never arrived', () => {
      expect(
        entryErrorKey(new NetworkError('ref', 'zones.join'), 'zones.join')
      ).toBe('entry.error.failed');
      expect(entryErrorKey(new Error('boom'), 'zones.create')).toBe(
        'entry.error.failed'
      );
    });
  });
});
