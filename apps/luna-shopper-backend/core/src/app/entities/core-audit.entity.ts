import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Whether a person or a machine made a change (plan 0075, section 1).
 *
 * Core writes `ADMIN` and only `ADMIN` today, because `CorePlatformAdminService`
 * has no service branch: nothing writes to a household's data on a machine's
 * behalf. The column is here anyway, because plan 0077 section 8 says these
 * three tables carry `catalog_audit`'s columns exactly, and a trail that has to
 * be widened later is a migration over rows nobody can re-derive.
 */
export enum CoreAuditActorKind {
  ADMIN = 'ADMIN',
  SERVICE = 'SERVICE',
}

/** What happened to the row. */
export enum CoreAuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/**
 * Who changed a core row, and what it said before (plan 0077, section 8).
 *
 * `catalog_audit`'s columns and indexes exactly, in core's database rather than
 * catalog's. **Not one shared table**: the audit row is written in the same
 * transaction as the change, and a transaction does not span two Postgres
 * instances. A trail that is sometimes written and sometimes not is worse than
 * none, because it gets trusted.
 *
 * Plan 0075 section 9 left core out, on the grounds that plan 0074's named
 * actions delegate to services whose behaviour is unchanged. That reasoning held
 * while an operator could only run seven named actions. It does not hold once an
 * operator can change a household's list, so the trail arrives here with the
 * writes that made it necessary, and 0074's actions are recorded in it too.
 *
 * **Nothing reads it**, exactly as plan 0075 section 5 decided for its own. The
 * value being bought is the recording, and a viewer can be built at any later
 * point against data that already exists.
 *
 * ## It does not extend `BaseEntity`
 *
 * An audit row is written once and never updated, so `updatedAt` would be a
 * column that can only ever repeat `at`, and a reader who found the two
 * disagreeing would be right to conclude the trail had been edited.
 */
@Entity({ name: 'core_audit' })
// Every query is "recently" or "between", so the time is the index that matters.
@Index('ix_core_audit_at', ['at'])
// A single row's own history is one lookup rather than a scan.
@Index('ix_core_audit_entity', ['entity', 'entityId'])
export class CoreAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * An `admin_users.id` from auth's database.
   *
   * No foreign key, and there could not be one: admins live in auth's database.
   * The trail records what the gate verified, which is the fact worth keeping
   * even after the admin row it names is deleted.
   */
  @Column({ type: 'uuid' })
  actorId!: string;

  // `enumName` is given so the entity names the type the migration creates.
  // TypeORM would otherwise derive `core_audit_actorKind_enum`, and the two would
  // only ever agree by accident.
  @Column({
    type: 'enum',
    enum: CoreAuditActorKind,
    enumName: 'core_audit_actor_kind',
  })
  actorKind!: CoreAuditActorKind;

  /** The table the changed row lives in: `zones`, `zone_memberships`, `list_lines`. */
  @Column({ type: 'varchar' })
  entity!: string;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({
    type: 'enum',
    enum: CoreAuditAction,
    enumName: 'core_audit_action',
  })
  action!: CoreAuditAction;

  /**
   * What the changed fields said before, or null on a create.
   *
   * **The changed fields only, never the whole row** (plan 0075, section 1). A
   * write that changes nothing writes no row at all.
   */
  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  /** What they say now, or null on a delete. */
  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'at' })
  at!: Date;
}
