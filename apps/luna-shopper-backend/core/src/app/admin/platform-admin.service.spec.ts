import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import { generateKeyPairSync } from 'node:crypto';
import { CorePlatformAdminService } from './platform-admin.service';

/**
 * Core's back office gate (plan 0074, section 7: every listing refuses a velista
 * user token and accepts an admin token).
 *
 * Against real RS256 keypairs and the real `JwtService`, because what is being
 * asserted lives inside the signature verification rather than in a branch of
 * ours. A velista access token failing here is not a policy this class
 * implements: it is signed with a key core does not verify against, and the day
 * somebody decides one keypair is enough, this is what fails.
 *
 * Deliberately **no service branch**, which is the difference from catalog's
 * gate. Catalog admits a configured machine because the harvester writes prices;
 * nothing writes to a household on a machine's behalf, so a request with no token
 * is refused here rather than falling through to an actor id check.
 */
const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

const pem = (key: { export: (o: object) => string | Buffer }) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

const jwt = new JwtService();

const gate = new CorePlatformAdminService(jwt, {
  getOrThrow: () => ({ adminJwtPublicKey: pem(adminKeys.publicKey) }),
} as never);

/** An operator token, exactly as `AdminTokenService` signs one. */
function adminToken(over: { expiresIn?: string; audience?: string } = {}) {
  return jwt.sign(
    { sub: 'a1' },
    {
      privateKey: adminKeys.privateKey,
      algorithm: 'RS256',
      audience: over.audience ?? ADMIN_TOKEN_AUDIENCE,
      expiresIn: over.expiresIn ?? '15m',
    }
  );
}

describe('CorePlatformAdminService', () => {
  it('accepts a live operator token and answers with the admin id', async () => {
    await expect(
      gate.requireAdmin({ userId: 'a1', adminToken: adminToken() })
    ).resolves.toBe('a1');
  });

  it('refuses a velista access token', async () => {
    // Signed with auth's key, which core does not verify admin tokens against.
    // This is the property the separate keypair buys, asserted rather than
    // assumed.
    const userToken = jwt.sign(
      { sub: 'u1', kind: UserKind.REGISTERED },
      { privateKey: authKeys.privateKey, algorithm: 'RS256', expiresIn: '15m' }
    );

    await expect(
      gate.requireAdmin({ userId: 'u1', adminToken: userToken })
    ).rejects.toThrow('That operator token was not accepted');
  });

  it('refuses an expired operator token', async () => {
    await expect(
      gate.requireAdmin({
        userId: 'a1',
        adminToken: adminToken({ expiresIn: '-1s' }),
      })
    ).rejects.toThrow('That operator token was not accepted');
  });

  it('refuses a token minted for another audience', async () => {
    // Redundant only for as long as the two keypairs stay separate, which is
    // exactly why it is checked: it is what stops a future key consolidation
    // merging the two principals silently.
    await expect(
      gate.requireAdmin({
        userId: 'a1',
        adminToken: adminToken({ audience: 'something-else' }),
      })
    ).rejects.toThrow('That operator token was not accepted');
  });

  it('refuses a caller presenting no token at all', async () => {
    // A uuid is not a credential. This is the branch catalog has and core does
    // not: there is no machine that reads somebody else's household.
    await expect(gate.requireAdmin({ userId: 'a1' })).rejects.toThrow(
      'Only an operator can read this'
    );
  });

  it('refuses a token that names no admin', async () => {
    const anonymous = jwt.sign(
      {},
      {
        privateKey: adminKeys.privateKey,
        algorithm: 'RS256',
        audience: ADMIN_TOKEN_AUDIENCE,
        expiresIn: '15m',
      }
    );

    await expect(
      gate.requireAdmin({ userId: '', adminToken: anonymous })
    ).rejects.toThrow('That operator token was not accepted');
  });
});
