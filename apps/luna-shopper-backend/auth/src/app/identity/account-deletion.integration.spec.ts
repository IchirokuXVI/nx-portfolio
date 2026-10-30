import {
  ACCOUNT_DELETION_STREAM,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { connect, JSONCodec, type NatsConnection } from 'nats';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { AuthAuditService } from '../audit/auth-audit.service';
import { AUTH_MIGRATIONS } from '../db/migrations';
import { AccountDeletions1773200000000 } from '../db/migrations/1773200000000-AccountDeletions';
import {
  AccountDeletion,
  AUTH_ENTITIES,
  AuthAudit,
  AuthAuditAction,
  AuthAuditActorKind,
  EmailVerification,
  User,
} from '../entities';
import {
  AccountDeletionPublisher,
  messageId,
} from '../events/account-deletion.publisher';
import { ReconciliationController } from '../reconciliation/reconciliation.controller';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';
import { InMemoryTermsService } from './terms.testing';

/**
 * An account deletion in auth against real Postgres and a slot's real NATS
 * (plan 0232, sections 4, 5 and 8).
 *
 * What only these can answer: that the jsonb scrub takes the person out of
 * every row the trail holds about them and touches no other row; that the
 * delete, its outbox row and the scrub commit together and roll back together;
 * that the stream acks what the publisher sends, and the row goes only after
 * that; and that `auth.existingUserIds` survives ids Postgres cannot cast.
 *
 * It works in a scratch schema of its own and drops it afterwards. It does
 * publish into the slot's `LUNA_ACCOUNT_DELETIONS` stream, with ids that name
 * no account anywhere, so a consumer that reads them finds nothing to do.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services auth
 *   LUNA_INTEGRATION=1 \
 *     AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     NATS_URL=nats://localhost:<port> \
 *     npx nx run luna-shopper-backend-auth:test-integration --testFile=account-deletion.integration
 */
const SCHEMA = 'plan0232_account_deletion_test';

/** An `admin_users.id`, recorded as the gate verified it and never resolved. */
const OPERATOR = '44444444-4444-4444-8444-444444444444';

const codec = JSONCodec<{ userId: string }>();

describeIntegration('an account deletion in auth (real Postgres, NATS)', () => {
  let dataSource: DataSource;
  let nats: NatsConnection;
  let audit: AuthAuditService;
  let publisher: AccountDeletionPublisher;
  let identity: IdentityService;
  let users: Repository<User>;
  let trail: Repository<AuthAudit>;
  let outbox: Repository<AccountDeletion>;
  const events = { userUsernameChanged: jest.fn() };

  /** An IdentityService over this schema, with the given audit and publisher. */
  function identityWith(
    trailService: AuthAuditService,
    deletions: Pick<AccountDeletionPublisher, 'publishSoon'>
  ): IdentityService {
    return new IdentityService(
      dataSource,
      {} as never,
      new TokenGrantService(),
      {} as never,
      {} as never,
      events as never,
      new UsernameGenerator(),
      trailService,
      {
        getOrThrow: () => ({
          smtp: { enabled: false },
          google: { enabled: false },
          impersonation: { enabled: false },
        }),
      } as never,
      {} as never,
      new InMemoryTermsService(),
      deletions as never,
      undefined as never
    );
  }

  beforeAll(async () => {
    const url = requiredEnv('AUTH_DB_URL');
    // NATS_URL is a shared key (luna-slot writes it beside the services, not in
    // auth's .env), so Nx does not load it for this target. Unset means slot 0's
    // broker, which is what CI runs; on another slot export it.
    const natsUrl = process.env['NATS_URL'] ?? 'nats://localhost:4222';

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
    trail = dataSource.getRepository(AuthAudit);
    outbox = dataSource.getRepository(AccountDeletion);
    audit = new AuthAuditService(dataSource);

    nats = await connect({ servers: [natsUrl] });
    publisher = new AccountDeletionPublisher(dataSource, {
      connect: () => connect({ servers: [natsUrl] }),
      // Never fires inside a spec: every pass here is one the spec asked for.
      intervalMs: 3_600_000,
    });
    await publisher.onModuleInit();
    // The pass onModuleInit starts finds an empty outbox; let it end.
    await publisher.publishPending();

    // Woken on every delete, but the spec drives the publish itself, so a
    // test can look at the outbox before the row leaves it.
    identity = identityWith(audit, { publishSoon: () => undefined });
  }, 120_000);

  afterAll(async () => {
    await publisher?.onApplicationShutdown();
    await nats?.drain();
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let serial = 0;
  async function person(): Promise<User> {
    serial += 1;
    return users.save(
      users.create({
        kind: UserKind.REGISTERED,
        username: `Swift Sail ${serial}`,
        email: `person${serial}@example.com`,
        displayName: `Alice Example ${serial}`,
      })
    );
  }

  /** Every trail row, as text, for "the person appears nowhere" assertions. */
  async function trailText(): Promise<
    Array<{ id: string; entityId: string; actorId: string; text: string }>
  > {
    return dataSource.query(
      `SELECT "id", "entityId"::text AS "entityId", "actorId"::text AS "actorId",
              coalesce("before"::text, '') || ' ' || coalesce("after"::text, '') AS "text"
         FROM "auth_audit"`
    );
  }

  /**
   * A support session's opening row, written the way `ImpersonationService`
   * writes it: the session id as `entityId`, the account in `after.userId`, and
   * the free text note beside it. Raw, because a real session needs the whole
   * handoff machinery and the trail row is all this spec reads.
   */
  async function sessionRow(userId: string): Promise<string> {
    const sessionId = randomUUID();
    await trail.insert({
      actorId: OPERATOR,
      actorKind: AuthAuditActorKind.ADMIN,
      entity: 'impersonation_sessions',
      entityId: sessionId,
      action: AuthAuditAction.CREATE,
      before: null,
      after: {
        userId,
        adminId: OPERATOR,
        reason: 'SUPPORT',
        reasonNote: 'Alice asked us to look at her list',
        userAgent: 'Mozilla/5.0 (Android 15)',
        endedAt: null,
      },
    });
    return sessionId;
  }

  it('takes the person out of every trail row and leaves other rows alone', async () => {
    const target = await person();
    const bystander = await person();

    // An operator renames the person, sets a display name, resends a
    // confirmation, opens a support session, and finally deletes the account.
    await identity.setUsernameAsOperator(target.id, 'Quiet Harbor', OPERATOR);
    await identity.setDisplayNameAsOperator(target.id, 'Alice B', OPERATOR);
    await audit.write(OPERATOR, (tx) =>
      tx.create(
        EmailVerification,
        tx.manager.create(EmailVerification, {
          userId: target.id,
          tokenHash: 'x'.repeat(64),
          expiresAt: new Date(Date.now() + 3_600_000),
        })
      )
    );
    const sessionId = await sessionRow(target.id);
    // The same kinds of rows about somebody else, which must not move.
    await identity.setUsernameAsOperator(bystander.id, 'Bold Reef', OPERATOR);
    const bystanderSession = await sessionRow(bystander.id);
    const untouched = await trail.find({
      where: [{ entityId: bystander.id }, { entityId: bystanderSession }],
      order: { id: 'ASC' },
    });

    await expect(
      identity.deleteAccountAsOperator(target.id, OPERATOR)
    ).resolves.toEqual({ userId: target.id, deleted: true });

    const forbidden = [
      target.id,
      target.email as string,
      target.displayName as string,
      target.username,
      'Quiet Harbor',
      'Alice B',
      'Alice asked us',
      'Mozilla',
    ];
    const rows = await trailText();
    for (const row of rows.filter(
      (r) => !untouched.some((u) => u.id === r.id)
    )) {
      for (const value of forbidden) {
        expect(row.text).not.toContain(value);
        expect(row.entityId).not.toBe(target.id);
        expect(row.actorId).not.toBe(target.id);
      }
    }

    // The deletion's own row says what kind of account went and nothing else.
    const deletion = await trail.findOneOrFail({
      where: { entity: 'users', action: AuthAuditAction.DELETE },
    });
    expect(Object.keys(deletion.before ?? {}).sort()).toEqual([
      'createdAt',
      'kind',
      'roles',
    ]);
    expect(deletion.before).toEqual(
      expect.objectContaining({ kind: UserKind.REGISTERED, roles: [] })
    );

    // One tombstone across the person's rows: the rename and the deletion
    // still read as one account's history, and the session row points at it.
    const tombstone = deletion.entityId;
    expect(tombstone).not.toBe(target.id);
    const renames = await trail.find({
      where: { entity: 'users', entityId: tombstone },
    });
    expect(renames).toHaveLength(3);
    const rename = renames.find((row) => row.after && 'username' in row.after);
    // The key stays, so a reader sees what moved; the value goes.
    expect(rename?.before).toEqual({ username: null });
    expect(rename?.after).toEqual({ username: null });
    const session = await trail.findOneOrFail({
      where: { entityId: sessionId },
    });
    expect(session.after).toEqual(
      expect.objectContaining({
        userId: tombstone,
        adminId: OPERATOR,
        reason: 'SUPPORT',
        reasonNote: null,
        userAgent: null,
      })
    );
    const verification = await trail.findOneOrFail({
      where: { entity: 'email_verifications' },
    });
    expect(verification.after?.['userId']).toBe(tombstone);

    // Somebody else's rows are exactly as they were.
    expect(
      await trail.find({
        where: [{ entityId: bystander.id }, { entityId: bystanderSession }],
        order: { id: 'ASC' },
      })
    ).toEqual(untouched);

    // The outbox holds the deletion until the publisher hands it on.
    expect(await outbox.findOneBy({ userId: target.id })).not.toBeNull();
    await publisher.publishPending();
    expect(await outbox.findOneBy({ userId: target.id })).toBeNull();
  });

  it('commits the delete and its outbox row together, and publishes it to the stream', async () => {
    const target = await person();
    const woken = jest.fn();
    const withPublisher = identityWith(audit, { publishSoon: woken });

    await expect(
      withPublisher.deleteAccount({ userId: target.id })
    ).resolves.toEqual({ userId: target.id, deleted: true });

    expect(await users.findOneBy({ id: target.id })).toBeNull();
    expect(await outbox.findOneBy({ userId: target.id })).not.toBeNull();
    expect(woken).toHaveBeenCalledTimes(1);

    await expect(publisher.publishPending()).resolves.toBe(1);

    expect(await outbox.findOneBy({ userId: target.id })).toBeNull();
    const jsm = await nats.jetstreamManager();
    const stored = await jsm.streams.getMessage(ACCOUNT_DELETION_STREAM.name, {
      last_by_subj: ACCOUNT_DELETION_STREAM.subject,
    });
    expect(codec.decode(stored.data)).toEqual({ userId: target.id });
    expect(stored.header.get('Nats-Msg-Id')).toBe(messageId(target.id));

    const info = await jsm.streams.info(ACCOUNT_DELETION_STREAM.name);
    expect(info.config.subjects).toEqual([ACCOUNT_DELETION_STREAM.subject]);
    expect(info.config.storage).toBe('file');
    expect(info.config.max_age).toBe(30 * 24 * 60 * 60 * 1e9);

    // A second delete of the same account removes nothing and queues nothing.
    await expect(
      withPublisher.deleteAccount({ userId: target.id })
    ).resolves.toEqual({ userId: target.id, deleted: false });
    expect(await outbox.count()).toBe(0);
    expect(woken).toHaveBeenCalledTimes(1);
  });

  it('rolls the whole deletion back when the scrub throws', async () => {
    const target = await person();
    await identity.setUsernameAsOperator(target.id, 'Calm Tide', OPERATOR);
    const before = await trail.find({ where: { entityId: target.id } });

    class FailingScrub extends AuthAuditService {
      override async scrubUser(
        manager: EntityManager,
        userId: string
      ): Promise<number> {
        // The scrub runs and then fails, so a rollback has something to undo.
        await super.scrubUser(manager, userId);
        throw new Error('scrub failed');
      }
    }
    const woken = jest.fn();
    const failing = identityWith(new FailingScrub(dataSource), {
      publishSoon: woken,
    });

    await expect(failing.deleteAccount({ userId: target.id })).rejects.toThrow(
      'scrub failed'
    );

    expect(await users.findOneBy({ id: target.id })).not.toBeNull();
    expect(await outbox.findOneBy({ userId: target.id })).toBeNull();
    expect(await trail.find({ where: { entityId: target.id } })).toEqual(
      before
    );
    expect(woken).not.toHaveBeenCalled();
  });

  it('answers auth.existingUserIds with only the ids auth knows', async () => {
    const kept = await person();
    const gone = await person();
    await identity.deleteAccount({ userId: gone.id });
    await publisher.publishPending();
    // An operator: core holds their id where they edited a list, and the
    // release task must not take it for a deleted account.
    const [operator]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO "admin_users" ("username", "passwordHash")
       VALUES ($1, 'not-a-hash') RETURNING "id"`,
      [`operator-${randomUUID()}`]
    );
    const reconciliation = new ReconciliationController(dataSource);

    await expect(
      reconciliation.existingUserIds({
        userIds: [gone.id, 'not-a-uuid', kept.id, operator.id, randomUUID()],
      })
    ).resolves.toEqual({ userIds: [kept.id, operator.id] });
  });

  it('undoes the outbox table cleanly and applies it again', async () => {
    const target = AUTH_MIGRATIONS.indexOf(AccountDeletions1773200000000);
    // In a loop, so a later migration does not break this spec.
    for (let i = AUTH_MIGRATIONS.length - 1; i >= target; i--) {
      await dataSource.undoLastMigration();
    }
    const exists = async () =>
      (
        await dataSource.query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = 'account_deletions'`,
          [SCHEMA]
        )
      ).length > 0;
    expect(await exists()).toBe(false);

    await dataSource.runMigrations();
    expect(await exists()).toBe(true);
  });
});
