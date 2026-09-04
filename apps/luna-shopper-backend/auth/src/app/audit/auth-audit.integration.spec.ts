import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { AUTH_MIGRATIONS } from '../db/migrations';
import {
  AUTH_ENTITIES,
  AuthAudit,
  AuthAuditAction,
  AuthAuditActorKind,
  Credential,
  EmailVerification,
  User,
} from '../entities';
import { AuthAuditService } from './auth-audit.service';

/**
 * Auth's audit trail against real Postgres (plan 0077, section 8).
 *
 * **A double cannot check any of this.** Every claim the plan makes about the
 * trail is a claim about a transaction: that the row and its trail commit
 * together, that a rollback takes both, and that a write which moved no field
 * wrote nothing. A fake repository would let a separately written trail pass
 * while it was exactly the thing the plan forbids.
 *
 * `auth_audit` is a **separate copy** of the machinery rather than a shared one,
 * because a transaction does not span two Postgres instances, so core's proof
 * says nothing about this one. A bug in auth's `AuditedWrite` would pass every
 * unit spec beside it and still leave a trail that survived a failed write.
 *
 * It exercises `AuthAuditService` directly rather than through the `AsOperator`
 * methods, and that is the right level for this file. What those methods write
 * and emit is asserted in `identity-operator-writes.spec.ts` against the same
 * fixtures their user facing twins use; what is left over, and what only a
 * database can answer, is whether the trail is genuinely transactional.
 *
 * The last case is auth's own rather than a translation of core's. Auth is the
 * one service whose audited tables carry secrets, and the fake asserts the same
 * property against a hand written key list. Only real column metadata catches a
 * `WRITE_BOOKKEEPING` entry that has stopped matching a renamed column.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own auth data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 AUTH_DB_URL=postgres://luna_auth:luna_auth@localhost:<port>/luna_auth \
 *     npx nx run luna-shopper-backend-auth:test-integration
 */
const SCHEMA = 'plan0077_auth_audit_test';

/** An `admin_users.id`, recorded as the gate verified it and never resolved. */
const OPERATOR = '33333333-3333-4333-8333-333333333333';

/** A hash shaped like the real thing, so a leak has something to leak. */
const SECRET = '$argon2id$v=19$m=65536,t=3,p=4$SALT$HASHVALUE';

describeIntegration('the auth audit trail (real Postgres)', () => {
  let dataSource: DataSource;
  let audit: AuthAuditService;
  let trail: Repository<AuthAudit>;
  let users: Repository<User>;

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
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    audit = new AuthAuditService(dataSource);
    trail = dataSource.getRepository(AuthAudit);
    users = dataSource.getRepository(User);
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await trail.clear();
  });

  /** The trail rows for one entity row, oldest first. */
  function historyOf(entity: string, entityId: string) {
    return trail.find({ where: { entity, entityId }, order: { at: 'ASC' } });
  }

  /** A distinct address per row: `uq_users_email` is unique where it is set. */
  let seq = 0;
  function nextEmail(): string {
    seq += 1;
    return `person${seq}@example.com`;
  }

  async function newUser(username = 'Swift Sail'): Promise<User> {
    return users.save(
      users.create({
        kind: UserKind.REGISTERED,
        username,
        email: nextEmail(),
        emailVerifiedAt: null,
        displayName: null,
      })
    );
  }

  it('records a create with the whole row and no before', async () => {
    const user = await audit.write(OPERATOR, (tx) =>
      tx.create(
        User,
        users.create({
          kind: UserKind.REGISTERED,
          username: 'Vela Rápida',
          email: nextEmail(),
          emailVerifiedAt: null,
          displayName: null,
        })
      )
    );

    const history = await historyOf('users', user.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorId: OPERATOR,
      // Auth has no service branch, so every row it writes is a person's.
      actorKind: AuthAuditActorKind.ADMIN,
      entity: 'users',
      entityId: user.id,
      action: AuthAuditAction.CREATE,
      before: null,
    });
    expect(history[0].after).toMatchObject({ username: 'Vela Rápida' });
  });

  it('records only the fields that moved, not the whole row', async () => {
    const user = await newUser();
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(User, {
        where: { id: user.id },
      });
      const before = { ...row };
      row.username = 'Steady Helm';
      return tx.update(User, before, row);
    });

    const history = await historyOf('users', user.id);
    expect(history).toHaveLength(1);
    // The one field that moved, and nothing else. A full snapshot on every write
    // buries the field that changed in the several that did not, and would put
    // an email address into the trail on every rename.
    expect(Object.keys(history[0].after ?? {})).toEqual(['username']);
    expect(history[0].before).toEqual({ username: 'Swift Sail' });
    expect(history[0].after).toEqual({ username: 'Steady Helm' });
  });

  it('writes no row for a write that changes nothing', async () => {
    const user = await newUser();
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(User, {
        where: { id: user.id },
      });
      const before = { ...row };
      // An operator who opened the edit form and saved it unchanged did not
      // change anything, and a trail that says otherwise is one to read past.
      // The name is written back rather than left alone, so the save really
      // happens and the silence comes from the diff rather than from a skipped
      // write.
      const unchanged = row.username;
      row.username = unchanged;
      return tx.update(User, before, row);
    });

    expect(await historyOf('users', user.id)).toHaveLength(0);
  });

  it('mentions neither updatedAt nor the id, which move or repeat on every write', async () => {
    const user = await newUser();
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(User, {
        where: { id: user.id },
      });
      const before = { ...row };
      row.displayName = 'Alice Cooper';
      return tx.update(User, before, row);
    });

    const [row] = await historyOf('users', user.id);
    expect(Object.keys(row.after ?? {})).not.toContain('updatedAt');
    expect(Object.keys(row.after ?? {})).not.toContain('id');
  });

  it('records what a deleted row said, so the trail can answer what was lost', async () => {
    const user = await newUser('Doomed Sail');
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(User, {
        where: { id: user.id },
      });
      await tx.delete(User, row);
    });

    const history = await historyOf('users', user.id);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe(AuthAuditAction.DELETE);
    expect(history[0].after).toBeNull();
    expect(history[0].before).toMatchObject({ username: 'Doomed Sail' });
    expect(await users.findOne({ where: { id: user.id } })).toBeNull();
  });

  it('writes no row when the change it describes rolled back', async () => {
    const user = await newUser('Unchanged');
    await trail.clear();

    const boom = new Error('the write failed after the trail was written');
    await expect(
      audit.write(OPERATOR, async (tx) => {
        const row = await tx.manager.findOneOrFail(User, {
          where: { id: user.id },
        });
        const before = { ...row };
        row.username = 'Never committed';
        await tx.update(User, before, row);
        // The trail row exists inside this transaction at this point, which is
        // the whole hazard: a trail written separately would survive.
        throw boom;
      })
    ).rejects.toThrow(boom);

    expect(await historyOf('users', user.id)).toHaveLength(0);
    const after = await users.findOneOrFail({ where: { id: user.id } });
    expect(after.username).toBe('Unchanged');
  });

  it('never records a secret column, whatever the audited row carries', async () => {
    const user = await newUser();
    await trail.clear();

    const { credential, verification } = await audit.write(
      OPERATOR,
      async (tx) => {
        const credential = await tx.create(
          Credential,
          dataSource
            .getRepository(Credential)
            .create({ userId: user.id, passwordHash: SECRET })
        );
        const verification = await tx.create(
          EmailVerification,
          dataSource.getRepository(EmailVerification).create({
            userId: user.id,
            tokenHash: SECRET,
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: null,
          })
        );
        return { credential, verification };
      }
    );

    // Both rows really hold one, so the trail has something to leak. The
    // assertion is against the entity's own column metadata rather than against
    // a list written here: a column renamed out from under `WRITE_BOOKKEEPING`
    // would keep passing a spec that restated the field names.
    expect(credential.passwordHash).toBe(SECRET);
    expect(verification.tokenHash).toBe(SECRET);

    const [recordedCredential] = await historyOf('credentials', credential.id);
    const [recordedVerification] = await historyOf(
      'email_verifications',
      verification.id
    );
    expect(recordedCredential.after).not.toHaveProperty('passwordHash');
    expect(recordedVerification.after).not.toHaveProperty('tokenHash');
    // Every column the entity declares is either recorded or deliberately
    // dropped, so the trail still answers what the row said.
    expect(recordedVerification.after).toMatchObject({ userId: user.id });
    expect(JSON.stringify(await trail.find())).not.toContain(SECRET);
  });
});
