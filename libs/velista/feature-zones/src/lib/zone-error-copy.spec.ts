import { GatewayError, NetworkError } from '@portfolio/velista/data-access';
import type { ErrorCode } from '@portfolio/velista/models';
import {
  correlationIdOf,
  shouldRefetch,
  zoneErrorKey,
  type ZoneOperation,
} from './zone-error-copy';

/**
 * Plan 0010 section 5.6, row by row.
 *
 * The acceptance criterion asks that each of these render its own copy rather than the
 * server's `message`, which is one line per code and therefore identical for every 403
 * in the product. Constructing the failure directly is what makes the table testable
 * exhaustively; `MembershipMemory` covers the half that has to be *reachable* without a
 * gateway, which is a different question.
 */
function failure(code: ErrorCode, status = 400): GatewayError {
  return new GatewayError({ code, status, correlationId: 'ref-9' });
}

describe('zoneErrorKey', () => {
  const rows: ReadonlyArray<[ErrorCode, ZoneOperation, string | null, string]> =
    [
      [
        'not_found',
        'zone.read',
        'zone.error.notAvailable',
        'no membership at all, which core answers as not found rather than forbidden',
      ],
      [
        'not_found',
        'member.govern',
        'zone.error.notAvailable',
        'the same sentence on any group call',
      ],
      [
        'forbidden',
        'zone.governance',
        'zone.error.roleChanged',
        "the caller's role changed underneath them",
      ],
      [
        'forbidden',
        'member.govern',
        'zone.error.roleChanged',
        'the same, from a row menu',
      ],
      [
        'validation_failed',
        'member.answer',
        null,
        'somebody else answered first, and nothing is said',
      ],
      [
        'conflict',
        'zone.claim',
        'zone.error.alreadyClaimed',
        'another admin took the group on first',
      ],
      [
        'rate_limited',
        'member.rename',
        'zone.error.tooManyRenames',
        'the usernameChange bucket',
      ],
      ['internal', 'zone.read', 'zone.error.failed', 'the generic panel'],
    ];

  it.each(rows)('maps %s on %s to %s (%s)', (code, operation, expected) => {
    expect(zoneErrorKey(failure(code), operation)).toBe(expected);
  });

  it('is silent only for an approval somebody else already answered', () => {
    // The one designed `null` in the file, and it must not spread. Two admins on the
    // same queue is the normal case, and the slower one has done nothing wrong.
    const silent = rows.filter(([, , key]) => key === null);

    expect(silent).toHaveLength(1);
    expect(zoneErrorKey(failure('validation_failed'), 'member.govern')).toBe(
      'zone.error.failed'
    );
  });

  it('reads a forbidden on a read as the group being unavailable', () => {
    // Unreachable in practice: section 3.3 decides the pending branch from `myStatus`
    // before any request is made. It still has to say something sane if it is reached.
    expect(zoneErrorKey(failure('forbidden', 403), 'zone.read')).toBe(
      'zone.error.notAvailable'
    );
  });

  it('falls back for a failure that never reached the transport', () => {
    expect(
      zoneErrorKey(new NetworkError('ref-1', 'zones.get'), 'zone.read')
    ).toBe('zone.error.failed');
    expect(zoneErrorKey(new Error('boom'), 'list.create')).toBe(
      'zone.error.failed'
    );
  });
});

describe('shouldRefetch', () => {
  it('refetches after a forbidden on a write, and not on a read', () => {
    // A `forbidden` on a write says the caller's role is not what the page believed,
    // so every control drawn from `myRole` is now wrong.
    expect(shouldRefetch(failure('forbidden', 403), 'zone.governance')).toBe(
      true
    );
    expect(shouldRefetch(failure('forbidden', 403), 'zone.read')).toBe(false);
  });

  it('does not refetch on anything else', () => {
    expect(shouldRefetch(failure('not_found', 404), 'member.govern')).toBe(
      false
    );
    expect(shouldRefetch(new Error('boom'), 'member.govern')).toBe(false);
  });
});

describe('correlationIdOf', () => {
  it('gives the server reference when there is one, and null otherwise', () => {
    expect(correlationIdOf(failure('internal', 500))).toBe('ref-9');
    expect(correlationIdOf(new Error('boom'))).toBeNull();
  });
});
