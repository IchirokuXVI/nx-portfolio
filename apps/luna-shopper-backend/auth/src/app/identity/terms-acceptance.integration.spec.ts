import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type Repository } from 'typeorm';
import { fakeAudit } from '../audit/auth-audit.testing';
import { AUTH_MIGRATIONS } from '../db/migrations';
import { TermsAcceptances1773100000000 } from '../db/migrations/1773100000000-TermsAcceptances';
import {
  AUTH_ENTITIES,
  TermsAcceptance,
  TermsAcceptanceVia,
  User,
} from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';
import { TermsService } from './terms.service';

/**
 * Terms acceptances against real Postgres (plan 0231, section 7).
 *
 * What only a database can answer: that the migration creates the table, its
 * enum and the two grant columns, and undoes them; that the unique key keeps
 * two concurrent accepts of one version to one row; that a Google state keeps
 * the version across the round trip; and that deleting the account takes its
 * rows.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=terms-acceptance.integration
 */
const SCHEMA = 'plan0231_terms_test';

const CURRENT = '2026-10-28+2026-12-15';

/** A challenge of the right shape: 43 base64url characters. */
const CHALLENGE = 'lgghW2CGVJuIAQbifjAcK_8CsFoeysR6G6EYjaO0E8c';

describeIntegration('terms acceptances (real Postgres)', () => {
  let dataSource: DataSource;
  let users: Repository<User>;
  let acceptances: Repository<TermsAcceptance>;
  let terms: TermsService;
  let identity: IdentityService;

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

    users = dataSource.getRepository(User);
    acceptances = dataSource.getRepository(TermsAcceptance);

    const config = {
      getOrThrow: () => ({
        smtp: { enabled: false },
        google: { enabled: true },
        impersonation: { enabled: false },
        terms: { currentVersion: CURRENT, acceptanceRequired: false },
      }),
    } as never;
    terms = new TermsService(dataSource, config);
    identity = new IdentityService(
      dataSource,
      {} as never,
      new TokenGrantService(),
      {} as never,
      {} as never,
      {} as never,
      new UsernameGenerator(),
      fakeAudit([]).service,
      config,
      {} as never,
      terms
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let serial = 0;
  async function guest(): Promise<User> {
    serial += 1;
    return users.save(
      users.create({
        kind: UserKind.TEMPORARY,
        username: `Quiet Lantern ${serial}`,
      })
    );
  }

  async function columns(table: string): Promise<string[]> {
    const rows: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2`,
      [SCHEMA, table]
    );
    return rows.map((row) => row.column_name);
  }

  it('creates the table, its enum and a version column on both Google grants', async () => {
    expect(await columns('terms_acceptances')).toEqual(
      expect.arrayContaining(['id', 'userId', 'version', 'acceptedAt', 'via'])
    );
    expect(await columns('oauth_states')).toContain('termsVersion');
    expect(await columns('oauth_handoffs')).toContain('termsVersion');
    const labels: Array<{ enumlabel: string }> = await dataSource.query(
      `SELECT e.enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'terms_acceptance_via' AND n.nspname = $1
        ORDER BY e.enumsortorder`,
      [SCHEMA]
    );
    expect(labels.map((row) => row.enumlabel)).toEqual(
      Object.values(TermsAcceptanceVia)
    );
  });

  it('keeps two concurrent accepts of one version to one row', async () => {
    const user = await guest();

    const [first, second] = await Promise.all([
      identity.acceptTerms({ userId: user.id, version: CURRENT }),
      identity.acceptTerms({ userId: user.id, version: CURRENT }),
    ]);

    expect(first).toEqual(second);
    expect(await acceptances.count({ where: { userId: user.id } })).toBe(1);
    const latest = await terms.latest(user.id);
    expect(latest?.version).toBe(CURRENT);
    expect(latest?.acceptedAt.toISOString()).toBe(first.acceptedAt);
  });

  it('records a guest in the transaction that writes it', async () => {
    const tokensOf = { issueTokens: async (u: User) => u } as never;
    const withTokens = new IdentityService(
      dataSource,
      tokensOf,
      new TokenGrantService(),
      {} as never,
      {} as never,
      {} as never,
      new UsernameGenerator(),
      fakeAudit([]).service,
      {
        getOrThrow: () => ({
          terms: { currentVersion: CURRENT, acceptanceRequired: false },
        }),
      } as never,
      {} as never,
      terms
    );
    const created = (await withTokens.createTemporaryUser({
      acceptedTermsVersion: CURRENT,
    })) as unknown as User;

    const rows = await acceptances.find({ where: { userId: created.id } });
    expect(rows).toEqual([
      expect.objectContaining({
        version: CURRENT,
        via: TermsAcceptanceVia.GUEST,
      }),
    ]);
  });

  it('carries the version on the state across the round trip', async () => {
    const { state } = await identity.mintOAuthState({
      codeChallenge: CHALLENGE,
      acceptedTermsVersion: CURRENT,
    });
    const payload = await identity.consumeOAuthState({ state });
    expect(payload.acceptedTermsVersion).toBe(CURRENT);
  });

  it('takes the rows of a deleted account with it', async () => {
    const user = await guest();
    await identity.acceptTerms({ userId: user.id, version: CURRENT });
    expect(await acceptances.count({ where: { userId: user.id } })).toBe(1);

    await users.delete({ id: user.id });

    expect(await acceptances.count({ where: { userId: user.id } })).toBe(0);
  });

  it('answers the row of the current version when the version moves back', async () => {
    const OLDER = '2026-10-28';
    const at = (currentVersion: string) => {
      const config = {
        getOrThrow: () => ({
          smtp: { enabled: false },
          google: { enabled: true },
          impersonation: { enabled: false },
          terms: { currentVersion, acceptanceRequired: true },
        }),
      } as never;
      return new IdentityService(
        dataSource,
        {} as never,
        new TokenGrantService(),
        {} as never,
        {} as never,
        {} as never,
        new UsernameGenerator(),
        fakeAudit([]).service,
        config,
        {} as never,
        new TermsService(dataSource, config)
      );
    };
    const user = await guest();
    const first = await at(OLDER).acceptTerms({
      userId: user.id,
      version: OLDER,
    });
    await at(CURRENT).acceptTerms({ userId: user.id, version: CURRENT });

    // A rollback past a template bump, or the operator clearing the revision.
    const back = at(OLDER);
    await expect(back.getProfile({ userId: user.id })).resolves.toMatchObject({
      termsAcceptedVersion: OLDER,
      termsAcceptedAt: first.acceptedAt,
    });
    expect((await terms.latest(user.id))?.version).toBe(CURRENT);
  });

  it('undoes cleanly and applies again', async () => {
    const target = AUTH_MIGRATIONS.indexOf(TermsAcceptances1773100000000);
    // In a loop, so a later migration does not break this spec.
    for (let i = AUTH_MIGRATIONS.length - 1; i >= target; i--) {
      await dataSource.undoLastMigration();
    }
    expect(await columns('terms_acceptances')).toEqual([]);
    expect(await columns('oauth_states')).not.toContain('termsVersion');
    expect(await columns('oauth_handoffs')).not.toContain('termsVersion');

    await dataSource.runMigrations();
    expect(await columns('terms_acceptances')).toContain('via');
  });
});
