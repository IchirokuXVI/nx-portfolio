import { GatewayError, NetworkError } from '@portfolio/velista/data-access';
import {
  correlationIdOf,
  listErrorEffect,
  listErrorKey,
  type ListOperation,
} from './list-error-copy';

/**
 * Plan 0012, section 5.7: every row of the table renders its own copy.
 *
 * The gateway gives every code one message, so the server's `message` reads identically
 * for every 403 in the product. The client keys its own copy on **code plus operation**,
 * and this is the assertion that the pairing is actually made rather than a `switch`
 * that falls through to the generic sentence for everything.
 */
function gateway(
  code: GatewayError['code'],
  status = 400,
  correlationId = 'ref-1'
): GatewayError {
  return new GatewayError({ code, status, correlationId });
}

describe('listErrorKey', () => {
  describe('reading the list', () => {
    it('says the list is not available when it is gone', () => {
      expect(listErrorKey(gateway('not_found', 404), 'lines.read')).toBe(
        'list.error.notAvailable'
      );
    });

    it('says exactly the same thing when access was withdrawn', () => {
      // Deliberately identical copy. The two are indistinguishable to the person
      // reading them, and a distinction drawn here would be for the developer.
      expect(listErrorKey(gateway('forbidden', 403), 'lines.read')).toBe(
        'list.error.notAvailable'
      );
    });
  });

  describe('writing a line', () => {
    it('tells a reader what they can and cannot do', () => {
      expect(listErrorKey(gateway('forbidden', 403), 'lines.write')).toBe(
        'list.error.readOnly'
      );
    });

    it('tells a demoted staff member their role changed', () => {
      expect(listErrorKey(gateway('forbidden', 403), 'lines.decide')).toBe(
        'list.error.roleChanged'
      );
    });

    it('says the same for a manage operation, which is a different rule', () => {
      expect(listErrorKey(gateway('forbidden', 403), 'list.manage')).toBe(
        'list.error.roleChanged'
      );
    });
  });

  describe('the silent one', () => {
    it('says nothing at all about a refused reorder', () => {
      // Somebody deleted a line mid drag. Two people editing one list is the normal
      // case, and the person who dragged has done nothing wrong.
      expect(
        listErrorKey(gateway('validation_failed', 400), 'lines.reorder')
      ).toBeNull();
    });

    it('still speaks up about a refused write', () => {
      expect(listErrorKey(gateway('validation_failed', 400), 'lines.write')).toBe(
        'list.error.failed'
      );
    });
  });

  describe('the rest', () => {
    it('asks somebody adding too fast to slow down', () => {
      expect(listErrorKey(gateway('rate_limited', 429), 'lines.write')).toBe(
        'list.error.tooFast'
      );
    });

    it('falls back to the generic sentence for an internal failure', () => {
      expect(listErrorKey(gateway('internal', 500), 'lines.write')).toBe(
        'list.error.failed'
      );
    });

    it('does not claim to know why a request never arrived', () => {
      const error = new NetworkError('ref-2', 'lines.write');

      expect(listErrorKey(error, 'lines.write')).toBe('list.error.failed');
    });

    it('handles something that is not an error object at all', () => {
      expect(listErrorKey('nope', 'lines.write')).toBe('list.error.failed');
    });
  });

  it('gives every operation a key, or a deliberate null', () => {
    // A guard against a `switch` growing a case that returns undefined.
    const operations: readonly ListOperation[] = [
      'lines.read',
      'lines.write',
      'lines.decide',
      'lines.reorder',
      'comments',
      'list.manage',
    ];

    for (const operation of operations) {
      for (const code of [
        'not_found',
        'forbidden',
        'validation_failed',
        'rate_limited',
        'internal',
      ] as const) {
        const key = listErrorKey(gateway(code), operation);
        expect(key === null || key.startsWith('list.error.')).toBe(true);
      }
    }
  });
});

/**
 * The structural half. Three of these change what the page **is** rather than what it
 * says, which is why the effect is decided separately from the copy.
 */
describe('listErrorEffect', () => {
  it('turns a refused write into the read only state, in place', () => {
    // Today this is the only way the client can learn the caller is a reader: there is
    // no `GET /v1/lists/:id/access` and `ListView` carries no role for them.
    expect(listErrorEffect(gateway('forbidden', 403), 'lines.write')).toBe(
      'read-only'
    );
  });

  it('does the same for a refused comment', () => {
    expect(listErrorEffect(gateway('forbidden', 403), 'comments')).toBe(
      'read-only'
    );
  });

  it('takes the page away when the list cannot be read', () => {
    expect(listErrorEffect(gateway('not_found', 404), 'lines.read')).toBe('gone');
    expect(listErrorEffect(gateway('forbidden', 403), 'lines.read')).toBe('gone');
  });

  it('rereads silently after a refused reorder', () => {
    expect(
      listErrorEffect(gateway('validation_failed', 400), 'lines.reorder')
    ).toBe('reread');
  });

  it('leaves the page alone for a demoted staff member', () => {
    // The page stays and the decision buttons leave, which the abilities recompute
    // from `myRole` once the zone refetches. Nothing structural happens here.
    expect(listErrorEffect(gateway('forbidden', 403), 'lines.decide')).toBe(
      'none'
    );
  });

  it('does nothing for a failure that never reached the gateway', () => {
    expect(listErrorEffect(new NetworkError('ref-3', 'lines.write'), 'lines.write')).toBe(
      'none'
    );
  });
});

describe('correlationIdOf', () => {
  it('hands back the reference a gateway failure carried', () => {
    expect(correlationIdOf(gateway('internal', 500, 'ref-9'))).toBe('ref-9');
  });

  it('is null when there is nothing to quote', () => {
    expect(correlationIdOf(new Error('boom'))).toBeNull();
  });
});
