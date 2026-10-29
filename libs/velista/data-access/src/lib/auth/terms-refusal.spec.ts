import { GatewayError, NetworkError } from '../errors';
import { termsRefusal } from './terms-refusal';

function refused(
  code: ConstructorParameters<typeof GatewayError>[0]['code'],
  status: number,
  details?: Record<string, unknown>
): GatewayError {
  return new GatewayError({ code, status, correlationId: 'c1', details });
}

describe('termsRefusal (velista 0173)', () => {
  it('reads a stale version and the version the server asks for now', () => {
    expect(
      termsRefusal(
        refused('terms_version_stale', 409, {
          currentVersion: '2026-10-29+2026-12-01',
        })
      )
    ).toEqual({ kind: 'stale', currentVersion: '2026-10-29+2026-12-01' });
  });

  it('reads a missing version', () => {
    expect(
      termsRefusal(
        refused('terms_acceptance_missing', 400, {
          currentVersion: '2026-10-29',
        })
      )
    ).toEqual({ kind: 'missing', currentVersion: '2026-10-29' });
  });

  it('answers the empty string when the details name no version', () => {
    expect(termsRefusal(refused('terms_version_stale', 409))).toEqual({
      kind: 'stale',
      currentVersion: '',
    });
    expect(
      termsRefusal(refused('terms_version_stale', 409, { currentVersion: 7 }))
    ).toEqual({ kind: 'stale', currentVersion: '' });
  });

  it('answers null for every other failure', () => {
    expect(termsRefusal(refused('conflict', 409))).toBeNull();
    expect(termsRefusal(refused('validation_failed', 400))).toBeNull();
    expect(termsRefusal(new NetworkError('c2', 'auth.register'))).toBeNull();
    expect(termsRefusal(new Error('boom'))).toBeNull();
    expect(termsRefusal(null)).toBeNull();
  });
});
