import { ParticipantKind } from '@portfolio/luna-shopper/contracts';
import { UnauthorizedException } from '@portfolio/luna-shopper/platform';
import { TokenVerifierService } from './token-verifier.service';

/**
 * Which of the two identities a socket token carries (plan 0051, section 9).
 *
 * This is where plan 0035's rule is amended rather than abandoned. That plan
 * established that **a token that names nobody is an invalid token**, which was
 * correct and was written when the only thing a token could name was a user. A
 * participant token is the one legitimate token naming no user, so the rule
 * becomes "names neither a user nor a live participant", and the last case below
 * is the half of it that did not change.
 */

function verifier(claims: unknown): TokenVerifierService {
  return new TokenVerifierService({
    verifyAsync: async () => {
      if (claims instanceof Error) {
        throw claims;
      }
      return claims;
    },
  } as never);
}

describe('verifying a socket token', () => {
  it('reads an account token as a user', async () => {
    const service = verifier({ sub: 'u-1', kind: 'REGISTERED' });
    await expect(service.verifyIdentity('t')).resolves.toEqual({
      kind: 'user',
      userId: 'u-1',
    });
  });

  it('reads a participant token as a participant, scoped to one basket', async () => {
    const service = verifier({
      participantId: 'p-1',
      aud: 'gl-1',
      kind: ParticipantKind.GUEST,
    });
    await expect(service.verifyIdentity('t')).resolves.toEqual({
      kind: 'participant',
      participantId: 'p-1',
      generatedListId: 'gl-1',
      participantKind: ParticipantKind.GUEST,
    });
  });

  it('refuses a participant token with no audience', async () => {
    // The single property that makes handing one to a guest acceptable: without
    // an audience it would be good on every basket.
    const service = verifier({ participantId: 'p-1', kind: 'GUEST' });
    await expect(service.verifyIdentity('t')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('still refuses a token that names neither (plan 0035, as amended)', async () => {
    const service = verifier({ kind: 'REGISTERED', iat: 1 });
    await expect(service.verifyIdentity('t')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('refuses a missing token without asking anything else', async () => {
    const service = verifier({ sub: 'u-1' });
    await expect(service.verifyIdentity(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('refuses a forged one before it ever looks at the shape', async () => {
    const service = verifier(new Error('bad signature'));
    await expect(service.verifyIdentity('t')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('prefers the user reading when a token somehow carries both', async () => {
    // Not a shape this system mints. It is pinned because the alternative is a
    // participant claim smuggled into an account token deciding the answer.
    const service = verifier({
      sub: 'u-1',
      participantId: 'p-1',
      aud: 'gl-1',
    });
    await expect(service.verifyIdentity('t')).resolves.toMatchObject({
      kind: 'user',
    });
  });
});
