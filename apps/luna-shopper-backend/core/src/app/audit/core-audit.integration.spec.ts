import {
  MembershipStatus,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { CORE_MIGRATIONS } from '../db/migrations';
import {
  CORE_ENTITIES,
  CoreAudit,
  CoreAuditAction,
  CoreAuditActorKind,
  Zone,
  ZoneMembership,
} from '../entities';
import { CoreAuditService } from './core-audit.service';

/**
 * Core's audit trail against real Postgres (plan 0077, section 8).
 *
 * **A double cannot check any of this.** Every claim the plan makes about the
 * trail is a claim about a transaction: that the row and its trail commit
 * together, that a rollback takes both, and that a write which moved no field
 * wrote nothing. A fake repository would let a separately written trail pass
 * while it was exactly the thing the plan forbids.
 *
 * It exercises `CoreAuditService` directly rather than through the `AsOperator`
 * methods, and that is the right level for this file. What those methods write
 * and emit is asserted in their own specs against the same fixtures their member
 * facing twins use; what is left over, and what only a database can answer, is
 * whether the trail is genuinely transactional.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own core data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration
 */
const SCHEMA = 'plan0077_audit_test';

/** An `admin_users.id` from auth's database, which core never resolves. */
const OPERATOR = '33333333-3333-4333-8333-333333333333';

describeIntegration('the core audit trail (real Postgres)', () => {
  let dataSource: DataSource;
  let audit: CoreAuditService;
  let trail: Repository<CoreAudit>;
  let zones: Repository<Zone>;

  beforeAll(async () => {
    const url = requiredEnv('CORE_DB_URL');

    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CORE_ENTITIES,
      migrations: CORE_MIGRATIONS,
      synchronize: false,
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    audit = new CoreAuditService(dataSource);
    trail = dataSource.getRepository(CoreAudit);
    zones = dataSource.getRepository(Zone);
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

  async function newZone(name = 'Flat'): Promise<Zone> {
    return zones.save(
      zones.create({
        name,
        joinCode: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: '44444444-4444-4444-8444-444444444444',
        config: {},
      })
    );
  }

  it('records a create with the whole row and no before', async () => {
    const zone = await audit.write(OPERATOR, (tx) =>
      tx.create(
        Zone,
        zones.create({
          name: 'Shared house',
          joinCode: 'ZZZ999',
          status: ZoneStatus.ACTIVE,
          ownerUserId: '44444444-4444-4444-8444-444444444444',
          config: {},
        })
      )
    );

    const history = await historyOf('zones', zone.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorId: OPERATOR,
      // Core has no service branch, so every row it writes is a person's.
      actorKind: CoreAuditActorKind.ADMIN,
      entity: 'zones',
      entityId: zone.id,
      action: CoreAuditAction.CREATE,
      before: null,
    });
    expect(history[0].after).toMatchObject({ name: 'Shared house' });
  });

  it('records only the fields that moved, not the whole row', async () => {
    const zone = await newZone();
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(Zone, {
        where: { id: zone.id },
      });
      const before = { ...row };
      row.name = 'Renamed';
      return tx.update(Zone, before, row);
    });

    const history = await historyOf('zones', zone.id);
    expect(history).toHaveLength(1);
    // The one field that moved, and nothing else. A full snapshot on every write
    // buries the field that changed in the dozen that did not.
    expect(Object.keys(history[0].after ?? {})).toEqual(['name']);
    expect(history[0].before).toEqual({ name: 'Flat' });
    expect(history[0].after).toEqual({ name: 'Renamed' });
  });

  it('writes no row for a write that changes nothing', async () => {
    const zone = await newZone();
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(Zone, {
        where: { id: zone.id },
      });
      const before = { ...row };
      // An operator who opened the edit form and saved it unchanged did not
      // change anything, and a trail that says otherwise is one to read past.
      // The name is written back rather than left alone, so the save really
      // happens and the silence comes from the diff rather than from a skipped
      // write.
      const unchanged = row.name;
      row.name = unchanged;
      return tx.update(Zone, before, row);
    });

    expect(await historyOf('zones', zone.id)).toHaveLength(0);
  });

  it('mentions neither updatedAt nor the line version, which move on every write', async () => {
    const zone = await newZone();
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(Zone, {
        where: { id: zone.id },
      });
      const before = { ...row };
      row.name = 'Second name';
      return tx.update(Zone, before, row);
    });

    const [row] = await historyOf('zones', zone.id);
    expect(Object.keys(row.after ?? {})).not.toContain('updatedAt');
    expect(Object.keys(row.after ?? {})).not.toContain('id');
  });

  it('records what a deleted row said, so the trail can answer what was lost', async () => {
    const zone = await newZone('Doomed');
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(Zone, {
        where: { id: zone.id },
      });
      await tx.delete(Zone, row);
    });

    const history = await historyOf('zones', zone.id);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe(CoreAuditAction.DELETE);
    expect(history[0].after).toBeNull();
    expect(history[0].before).toMatchObject({ name: 'Doomed' });
    expect(await zones.findOne({ where: { id: zone.id } })).toBeNull();
  });

  it('writes no row when the change it describes rolled back', async () => {
    const zone = await newZone('Unchanged');
    await trail.clear();

    const boom = new Error('the write failed after the trail was written');
    await expect(
      audit.write(OPERATOR, async (tx) => {
        const row = await tx.manager.findOneOrFail(Zone, {
          where: { id: zone.id },
        });
        const before = { ...row };
        row.name = 'Never committed';
        await tx.update(Zone, before, row);
        // The trail row exists inside this transaction at this point, which is
        // the whole hazard: a trail written separately would survive.
        throw boom;
      })
    ).rejects.toThrow(boom);

    expect(await historyOf('zones', zone.id)).toHaveLength(0);
    const after = await zones.findOneOrFail({ where: { id: zone.id } });
    expect(after.name).toBe('Unchanged');
  });

  it('records a membership under its own table name, not the zone’s', async () => {
    const zone = await newZone();
    const memberships = dataSource.getRepository(ZoneMembership);
    const membership = await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: '55555555-5555-4555-8555-555555555555',
        username: 'ana',
        role: ZoneRole.MEMBER,
        status: MembershipStatus.PENDING,
      })
    );
    await trail.clear();

    await audit.write(OPERATOR, async (tx) => {
      const row = await tx.manager.findOneOrFail(ZoneMembership, {
        where: { id: membership.id },
      });
      const before = { ...row };
      row.status = MembershipStatus.APPROVED;
      // Null on an operator approval, and it stays nullable for exactly this:
      // an operator is not a member of the zone, so there is no membership id to
      // record, and every other reader treats the column as a `users.id`.
      row.approvedByUserId = null;
      return tx.update(ZoneMembership, before, row);
    });

    const history = await historyOf('zone_memberships', membership.id);
    expect(history).toHaveLength(1);
    expect(history[0].after).toMatchObject({
      status: MembershipStatus.APPROVED,
    });
  });
});
