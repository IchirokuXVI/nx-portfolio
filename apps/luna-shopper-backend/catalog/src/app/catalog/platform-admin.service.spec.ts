import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import { PlatformAdminService } from './platform-admin.service';

/**
 * Catalog's gate (plan 0072, section 6).
 *
 * Everything here runs against real RS256 keypairs and the real verifier,
 * because what is being asserted lives inside the signature check rather than in
 * a branch of ours. A mocked verifier would pass this file and let a token signed
 * with the wrong key through in production.
 *
 * The old version of this file configured two uuids and asserted `.has()`. That
 * is the mechanism the plan deleted, and none of it survives: there is no
 * `isAdmin`, no allowlist, and no way to pass this gate as a person without a
 * signature.
 */
const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

const pem = (key: { export: (o: object) => string | Buffer }) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

const jwt = new JwtService();
const HARVESTER = 'ac700000-0000-4000-a000-000000000001';

/** An operator token, exactly as `AdminTokenService` signs one. */
function signAdmin(
  overrides: {
    sub?: string;
    audience?: string;
    expiresIn?: string;
    privateKey?: typeof adminKeys.privateKey;
  } = {}
) {
  return jwt.sign(
    { sub: overrides.sub ?? 'admin-1' },
    {
      privateKey: overrides.privateKey ?? adminKeys.privateKey,
      algorithm: 'RS256',
      audience: overrides.audience ?? ADMIN_TOKEN_AUDIENCE,
      expiresIn: overrides.expiresIn ?? '15m',
    }
  );
}

function makeService(serviceActorIds: string[] = []): PlatformAdminService {
  return new PlatformAdminService(jwt, {
    getOrThrow: () => ({
      adminJwtPublicKey: pem(adminKeys.publicKey),
      serviceActorIds,
    }),
  } as never);
}

describe('PlatformAdminService (catalog)', () => {
  describe('the admin path', () => {
    it('accepts a valid operator token and answers who it named', async () => {
      const svc = makeService();
      await expect(
        svc.requireAdmin({ userId: 'ignored', adminToken: signAdmin() })
      ).resolves.toEqual({ kind: 'admin', actorId: 'admin-1' });
    });

    it('refuses an expired token', async () => {
      const svc = makeService();
      const token = signAdmin({ expiresIn: '-1s' });
      await expect(
        svc.requireAdmin({ userId: 'admin-1', adminToken: token })
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a token signed with the auth key', async () => {
      // The case the second keypair exists to make unrepresentable: this token
      // is structurally an admin token and says so in its audience.
      const svc = makeService();
      const token = signAdmin({ privateKey: authKeys.privateKey });
      await expect(
        svc.requireAdmin({ userId: 'admin-1', adminToken: token })
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a token with the wrong audience', async () => {
      const svc = makeService();
      const token = signAdmin({ audience: 'velista' });
      await expect(
        svc.requireAdmin({ userId: 'admin-1', adminToken: token })
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a velista access token', async () => {
      // Signed with auth's key and carrying no audience at all, which is what
      // `TokenService` produces for an ordinary user.
      const svc = makeService();
      const token = jwt.sign(
        { sub: 'u1', kind: UserKind.REGISTERED },
        {
          privateKey: authKeys.privateKey,
          algorithm: 'RS256',
          expiresIn: '15m',
        }
      );
      await expect(
        svc.requireAdmin({ userId: 'u1', adminToken: token })
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not fall back to the service path when a token is present but bad', async () => {
      // A caller holding a configured service id AND a broken token is refused.
      // Falling through would let anyone with the harvester's uuid keep writing
      // by attaching rubbish, which is the allowlist weakness again.
      const svc = makeService([HARVESTER]);
      await expect(
        svc.requireAdmin({ userId: HARVESTER, adminToken: 'not-a-token' })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('the service path', () => {
    it('accepts the configured harvester actor with no token', async () => {
      const svc = makeService([HARVESTER]);
      await expect(svc.requireAdmin({ userId: HARVESTER })).resolves.toEqual({
        kind: 'service',
        actorId: HARVESTER,
      });
    });

    it('refuses an unconfigured uuid', async () => {
      const svc = makeService([HARVESTER]);
      await expect(
        svc.requireAdmin({ userId: 'bb700000-0000-4000-a000-000000000002' })
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses everyone when no service is configured', async () => {
      const svc = makeService([]);
      await expect(svc.requireAdmin({ userId: HARVESTER })).rejects.toThrow(
        ForbiddenException
      );
    });

    it('tells the two refusals apart', async () => {
      // Section 4 asks for separate messages so a log line says which branch
      // turned the caller away.
      const svc = makeService([HARVESTER]);
      const asService = await svc
        .requireAdmin({ userId: 'nobody' })
        .catch((error: Error) => error.message);
      const asAdmin = await svc
        .requireAdmin({ userId: 'nobody', adminToken: 'not-a-token' })
        .catch((error: Error) => error.message);
      expect(asService).not.toEqual(asAdmin);
    });
  });
});
