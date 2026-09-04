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
 * Auth writes `ADMIN` and only `ADMIN`. `AuthPlatformAdminService` has no
 * service branch on purpose: nothing writes to the user directory on a machine's
 * behalf, and a service actor here would mean a uuid in configuration could
 * rename anybody. The column exists anyway, because plan 0077 section 8 says
 * these three tables carry `catalog_audit`'s columns exactly, and a trail that
 * has to be widened later is a migration over rows nobody can re-derive.
 */
export enum AuthAuditActorKind {
  ADMIN = 'ADMIN',
  SERVICE = 'SERVICE',
}

/** What happened to the row. */
export enum AuthAuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/**
 * Who changed an auth row, and what it said before (plan 0077, section 8).
 *
 * `catalog_audit`'s columns and indexes exactly, in auth's database rather than
 * catalog's. **Not one shared table**: the audit row is written in the same
 * transaction as the change, and a transaction does not span two Postgres
 * instances. A trail that is sometimes written and sometimes not is worse than
 * none, because it gets trusted.
 *
 * Plan 0075 section 9 left auth out, on the grounds that plan 0074's named
 * actions delegate to services whose behaviour is unchanged. That reasoning held
 * while an operator could only delete an account and resend a confirmation mail.
 * It does not hold once an operator can rename somebody, so the trail arrives
 * here with the write that made it necessary, and 0074's two actions are
 * recorded in it too.
 *
 * **Nothing reads it**, exactly as plan 0075 section 5 decided for its own. The
 * value being bought is the recording, and a viewer can be built at any later
 * point against data that already exists.
 *
 * ## It does not extend `BaseEntity`
 *
 * Every other auth entity does, and this one deliberately does not. An audit row
 * is written once and never updated, so `updatedAt` would be a column that can
 * only ever repeat `at`, and a reader who found the two disagreeing would be
 * right to conclude the trail had been edited.
 */
@Entity({ name: 'auth_audit' })
// Every query is "recently" or "between", so the time is the index that matters.
@Index('ix_auth_audit_at', ['at'])
// A single row's own history is one lookup rather than a scan.
@Index('ix_auth_audit_entity', ['entity', 'entityId'])
export class AuthAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * An `admin_users.id`, which for once does live in this database.
   *
   * Still no foreign key, and the reason is the same one core and catalog give:
   * the trail records what the gate verified, which is the fact worth keeping
   * even after the admin row it names is deleted. A cascade here would erase the
   * history of an operator at the moment their access was withdrawn, which is
   * exactly when somebody reads it.
   */
  @Column({ type: 'uuid' })
  actorId!: string;

  // `enumName` is given so the entity names the type the migration creates.
  // TypeORM would otherwise derive `auth_audit_actorKind_enum`, and the two would
  // only ever agree by accident.
  @Column({
    type: 'enum',
    enum: AuthAuditActorKind,
    enumName: 'auth_audit_actor_kind',
  })
  actorKind!: AuthAuditActorKind;

  /** The table the changed row lives in: `users`, `email_verifications`. */
  @Column({ type: 'varchar' })
  entity!: string;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({
    type: 'enum',
    enum: AuthAuditAction,
    enumName: 'auth_audit_action',
  })
  action!: AuthAuditAction;

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
