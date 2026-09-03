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
 * Without it an actor id is ambiguous: an admin id and the harvester's
 * configured service id are both uuids, and nothing about the value says which
 * table it would resolve against. It is a stored column rather than something
 * derived at read time because plan 0075 section 4 prunes on it, and a retention
 * job that has to resolve four thousand ids to decide what to keep is a join
 * against a database in another service.
 */
export enum AuditActorKind {
  ADMIN = 'ADMIN',
  SERVICE = 'SERVICE',
}

/** What happened to the row. */
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/**
 * Who changed a catalog row, and what it said before (plan 0075).
 *
 * `SupermarketItem` already carries `priceSourceKind` and `priceObservedAt`,
 * which answer "was this number typed or fetched, and how old is it". Neither
 * answers "I changed something last Tuesday and now a number is wrong, what did
 * I change". This table is the second question, and it is written now rather
 * than when it is first wanted because history that was not recorded cannot be
 * recovered afterwards.
 *
 * **Nothing reads it in plan 0075**, and that is deliberate rather than
 * unfinished. The value being bought is the recording. A viewer can be built at
 * any later point against data that already exists.
 *
 * ## It does not extend `BaseEntity`
 *
 * Every other catalog entity does, and this one deliberately does not. An audit
 * row is written once and never updated, so `updatedAt` would be a column that
 * can only ever repeat `at`, and a reader who found the two disagreeing would be
 * right to conclude the trail had been edited. The columns here are exactly the
 * ones section 1 of the plan lists.
 */
@Entity({ name: 'catalog_audit' })
// Every query is "recently" or "between", so the time is the index that matters.
@Index('ix_catalog_audit_at', ['at'])
// A single row's own history is one lookup rather than a scan.
@Index('ix_catalog_audit_entity', ['entity', 'entityId'])
export class CatalogAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * An `admin_users.id` from auth's database, or a configured service actor id.
   *
   * No foreign key, and there could not be one: admins live in auth's database
   * and the harvester's id lives in a configuration value. The trail records what
   * the gate verified, which is the fact worth keeping even after the admin row
   * it names is deleted.
   */
  @Column({ type: 'uuid' })
  actorId!: string;

  // `enumName` is given so the entity names the type the migration creates.
  // TypeORM would otherwise derive `catalog_audit_actorKind_enum`, and the two
  // would only ever agree by accident.
  @Column({
    type: 'enum',
    enum: AuditActorKind,
    enumName: 'catalog_audit_actor_kind',
  })
  actorKind!: AuditActorKind;

  /** The table the changed row lives in: `supermarket_items`, `items`. */
  @Column({ type: 'varchar' })
  entity!: string;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
    enumName: 'catalog_audit_action',
  })
  action!: AuditAction;

  /**
   * What the changed fields said before, or null on a create.
   *
   * **The changed fields only, never the whole row** (plan 0075, section 1). A
   * full snapshot on every write of a table with 4,232 products grows without
   * bound and buries the one field that moved in the thirty that did not.
   */
  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  /** What they say now, or null on a delete. */
  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'at' })
  at!: Date;
}
