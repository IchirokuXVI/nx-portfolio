import { AuthProvider, UserKind } from '@portfolio/luna-shopper/contracts';
import {
  GoogleSignInNeedsConsentException,
  InvalidGoogleTokenException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { fakeAudit } from '../audit/auth-audit.testing';
import { AUTH_MIGRATIONS } from '../db/migrations';
import { OAuthNonces1773400000000 } from '../db/migrations/1773400000000-OAuthNonces';
import {
  AUTH_ENTITIES,
  OAuthIdentity,
  OAuthNonce,
  TermsAcceptance,
  User,
} from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import type {
  GoogleIdTokenClaims,
  GoogleIdTokenVerifier,
} from './google-id-token-verifier';
import { IdentityService } from './identity.service';
import { TermsService } from './terms.service';

/**
 * The sign in with a Google ID token against real Postgres (plan 0238).
 *
 * What only a database can answer: that two requests carrying one token at
 * the same instant produce one pair, because the conditional spend of
 * `TokenGrantService` lets one of them through and the other finds the nonce
 * spent; that a refused silent sign in writes no row; and that the migration
 * creates the table and undoes it. The verifier is a double that answers fixed
 * claims, so nothing reaches Google.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=google-id-token.integration
 */
const SCHEMA = 'plan0238_google_id_token_test';

const CURRENT = '2026-10-28+2026-12-15';

describeIntegration(
  'the sign in with a Google ID token (real Postgres)',
  () => {
    let dataSource: DataSource;
    let identity: IdentityService;
    const claimsByToken = new Map<string, GoogleIdTokenClaims>();

    beforeAll(async () => {
      const url = requiredEnv('AUTH_DB_URL');

      const bootstrap = new DataSource({ type: 'postgres', url });
      await bootstrap.initialize();
      await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
      await bootstrap.destroy();

      dataSource = new DataSource({
        type: 'postgres',
        url,
        schema: SCHEMA,
        entities: AUTH_ENTITIES,
        migrations: AUTH_MIGRATIONS,
        synchronize: false,
        extra: { options: `-c search_path=${SCHEMA},public` },
      });
      await dataSource.initialize();
      await dataSource.runMigrations();

      const config = {
        getOrThrow: () => ({
          smtp: { enabled: false },
          google: { enabled: true, clientId: 'web-client' },
          impersonation: { enabled: false },
          terms: { currentVersion: CURRENT, acceptanceRequired: false },
        }),
      } as never;
      // A pair that names the user it was issued for, and nothing more: the
      // spec counts pairs, not their signatures.
      const tokens = {
        issueTokens: async (user: User) => ({
          userId: user.id,
          kind: user.kind,
          username: user.username,
          accessToken: `access-${user.id}`,
          refreshToken: `refresh-${user.id}`,
        }),
        revokeAllForUser: async () => undefined,
      };
      const verifier = {
        verify: async (idToken: string) => claimsByToken.get(idToken) ?? null,
      };
      identity = new IdentityService(
        dataSource,
        tokens as never,
        new TokenGrantService(),
        {} as never,
        {} as never,
        {
          userRegistered: () => undefined,
          userUpgraded: () => undefined,
        } as never,
        new UsernameGenerator(),
        fakeAudit([]).service,
        config,
        {} as never,
        new TermsService(dataSource, config),
        { publishSoon: () => undefined } as never,
        verifier as unknown as GoogleIdTokenVerifier
      );
    }, 120_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    let serial = 0;
    /** A token the double accepts, for a Google account of its own. */
    function tokenFor(nonce: string): { idToken: string; sub: string } {
      serial += 1;
      const sub = `g-${serial}-${Date.now()}`;
      const idToken = `id-token-${sub}`;
      claimsByToken.set(idToken, {
        sub,
        email: `${sub}@example.com`,
        emailVerified: true,
        name: 'Example Person',
        nonce,
      });
      return { idToken, sub };
    }

    async function usersOf(sub: string): Promise<number> {
      return dataSource
        .getRepository(OAuthIdentity)
        .count({
          where: { provider: AuthProvider.GOOGLE, providerUserId: sub },
        });
    }

    it('creates the table with its indexes', async () => {
      const indexes: Array<{ indexname: string }> = await dataSource.query(
        `SELECT "indexname" FROM pg_indexes WHERE "schemaname" = $1 AND "tablename" = 'oauth_nonces'`,
        [SCHEMA]
      );
      expect(indexes.map((row) => row.indexname).sort()).toEqual([
        'ix_oauth_nonces_expires_at',
        'ix_oauth_nonces_user',
        'pk_oauth_nonces',
        'uq_oauth_nonce_token',
      ]);
    });

    it('two spends of one nonce at the same instant produce one pair', async () => {
      const { nonce } = await identity.mintGoogleNonce({
        acceptedTermsVersion: CURRENT,
      });
      const { idToken, sub } = tokenFor(nonce);

      const results = await Promise.allSettled([
        identity.signInWithGoogleIdToken({ idToken }),
        identity.signInWithGoogleIdToken({ idToken }),
      ]);

      const pairs = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      expect(pairs).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0].reason).toBeInstanceOf(InvalidGoogleTokenException);
      expect(await usersOf(sub)).toBe(1);
      const userId = (pairs[0] as PromiseFulfilledResult<{ userId: string }>)
        .value.userId;
      expect(
        await dataSource.getRepository(User).findOneByOrFail({ id: userId })
      ).toMatchObject({
        kind: UserKind.REGISTERED,
        email: `${sub}@example.com`,
      });
      expect(
        await dataSource.getRepository(TermsAcceptance).count({
          where: { userId },
        })
      ).toBe(1);
      const row = await dataSource
        .getRepository(OAuthNonce)
        .findOneByOrFail({ tokenHash: new TokenGrantService().hash(nonce) });
      expect(row.consumedAt).toBeInstanceOf(Date);
    });

    it('a silent nonce for a Google account it does not know writes no row', async () => {
      const before = await dataSource.getRepository(User).count();
      const { nonce } = await identity.mintGoogleNonce({ silent: true });
      const { idToken, sub } = tokenFor(nonce);

      await expect(
        identity.signInWithGoogleIdToken({ idToken })
      ).rejects.toBeInstanceOf(GoogleSignInNeedsConsentException);

      expect(await dataSource.getRepository(User).count()).toBe(before);
      expect(await usersOf(sub)).toBe(0);
    });

    it('undoes cleanly and applies again', async () => {
      const tables = async () =>
        (
          (await dataSource.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'oauth_nonces'`,
            [SCHEMA]
          )) as unknown[]
        ).length;
      const target = AUTH_MIGRATIONS.indexOf(OAuthNonces1773400000000);
      // In a loop, so a later migration does not break this spec.
      for (let i = AUTH_MIGRATIONS.length - 1; i >= target; i--) {
        await dataSource.undoLastMigration();
      }
      expect(await tables()).toBe(0);

      await dataSource.runMigrations();
      expect(await tables()).toBe(1);
    });
  }
);
