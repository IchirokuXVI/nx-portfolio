import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  type EntityTarget,
  type FindOptionsWhere,
  type ObjectLiteral,
} from 'typeorm';
import { AuthAudit, AuthAuditAction, AuthAuditActorKind } from '../entities';

/** A row's fields as the trail stores them: json, one level, no relations. */
export type AuditFields = Record<string, unknown>;

/**
 * Fields the trail never mentions (plan 0075, section 4, applied to auth by plan
 * 0077 section 8).
 *
 * The first three say nothing about what a row means:
 *
 * - `id` is already the `entityId` column, and repeating it inside the diff
 *   would double the size of the smallest useful row.
 * - `createdAt` cannot change, and `updatedAt` changes on every single write, so
 *   including it would make the "a write that changes nothing writes no row"
 *   rule unreachable: every update would carry at least one moved field.
 *
 * The last two are here for a different reason, and it is the important one: a
 * secret must never reach the trail. `email_verifications` is audited, and its
 * `tokenHash` is the stored half of a link that confirms an address; the trail
 * is read by operators and pruned by nobody, so copying the hash into it would
 * turn a single use grant into a durable one. `passwordHash` is not on any table
 * audited today, and it is named anyway: it is a column on `credentials` and on
 * `admin_users`, and a future write against either of those must not be one
 * forgotten line away from publishing an argon2 hash.
 */
const WRITE_BOOKKEEPING: ReadonlySet<string> = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'tokenHash',
  'passwordHash',
]);

/**
 * Who changed an auth row, and what it said before (plan 0077, section 8).
 *
 * Every write behind `/v1/admin/users/**` goes through {@link write}: the rename,
 * the display name, and plan 0074's two named actions, which are writes by an
 * operator against somebody else's data and so are the whole category this table
 * exists for. Reads are not audited, for plan 0075's reason: a back office with
 * one operator generates no interesting read trail, and a paginated listing would
 * write far more rows for its reads than for its writes.
 *
 * ## The transaction is the point
 *
 * {@link write} opens one transaction and hands the caller an {@link AuditedWrite}
 * that persists the change and the audit row through the same
 * {@link EntityManager}. That is not tidiness. A trail written separately can
 * succeed when the change fails, or fail when the change succeeds, and a trail
 * that is sometimes wrong is worse than no trail at all, because it gets trusted.
 *
 * ## Every emit happens after the transaction commits
 *
 * The `AsOperator` methods that use this return from inside the callback and emit
 * outside it. `user.usernameChanged` is what makes core rewrite the per zone
 * names, so an event for a transaction that then rolled back would leave every
 * zone calling somebody by a name the `users` row never took.
 *
 * ## The actor comes from the gate, not from the caller
 *
 * `AuthPlatformAdminService.requireAdmin` returns the admin id from the verified
 * claims, so nothing here asks a second time and nothing can record an actor the
 * gate did not verify. Auth has no service branch, so every row it writes is
 * `ADMIN`.
 */
@Injectable()
export class AuthAuditService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Run a change and its audit rows in one transaction.
   *
   * Reads a caller performs through its own injected repositories are outside
   * this transaction, deliberately: the guarantee being bought is that the trail
   * matches what was committed, not that every validating lookup became
   * serializable at the same time.
   */
  write<T>(
    actorId: string,
    work: (tx: AuditedWrite) => Promise<T>
  ): Promise<T> {
    return this.dataSource.transaction((manager) =>
      work(new AuditedWrite(manager, this.dataSource, actorId))
    );
  }
}

/**
 * One transaction, and the changes recorded inside it.
 *
 * Handed to the callback of {@link AuthAuditService.write}. Every method here
 * both persists and records, so a write site cannot do one and forget the other.
 */
export class AuditedWrite {
  constructor(
    /** For a caller that must read or write something these methods do not cover. */
    readonly manager: EntityManager,
    private readonly dataSource: DataSource,
    private readonly actorId: string
  ) {}

  /** Persist a new row, and record everything it says. */
  async create<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    draft: T
  ): Promise<T> {
    const saved = await this.manager.save(target, draft);
    await this.recordCreate(target, saved);
    return saved;
  }

  /**
   * Persist an edit, and record only the fields that moved.
   *
   * `before` is the row as it was, which the caller captures with `{ ...row }`
   * before it starts assigning. It has to be the caller's copy: by the time this
   * runs, the row object holds the new values and the old ones are gone. A
   * shallow copy is enough, because the trail stores one level of fields.
   */
  async update<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    before: ObjectLiteral,
    row: T
  ): Promise<T> {
    const saved = await this.manager.save(target, row);
    await this.recordUpdate(target, before, saved);
    return saved;
  }

  /**
   * Delete a row, and record what it said.
   *
   * The row is loaded rather than deleted by id alone, because `before` is the
   * whole point: a deletion whose trail says only that something with this id
   * used to exist cannot answer what was lost.
   */
  async delete<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    row: T
  ): Promise<void> {
    // Both read before the delete. `manager.remove` strips the primary key off
    // the object it is handed, so an id read afterwards is undefined and the
    // trail would record a deletion of nothing.
    const entityId = row['id'] as string;
    const before = this.snapshot(target, row);
    await this.manager.delete(
      target,
      // Every auth entity keys on `id`, but nothing in `T` says so, so the
      // criteria cannot be expressed in the generic.
      { id: entityId } as unknown as FindOptionsWhere<T>
    );
    await this.insert(target, entityId, AuthAuditAction.DELETE, {
      before,
      after: null,
    });
  }

  /** Record a creation another call persisted. */
  async recordCreate<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    row: T
  ): Promise<void> {
    await this.insert(target, row['id'] as string, AuthAuditAction.CREATE, {
      before: null,
      after: this.snapshot(target, row),
    });
  }

  /** Record an edit another call persisted, or record nothing if none moved. */
  async recordUpdate<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    before: ObjectLiteral,
    row: T
  ): Promise<void> {
    const moved = diffFields(
      this.snapshot(target, before),
      this.snapshot(target, row)
    );
    if (!moved) {
      return;
    }
    await this.insert(
      target,
      row['id'] as string,
      AuthAuditAction.UPDATE,
      moved
    );
  }

  /** Record a deletion another call persisted, from the row as it last was. */
  async recordDelete<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    row: ObjectLiteral,
    entityId: string
  ): Promise<void> {
    await this.insert(target, entityId, AuthAuditAction.DELETE, {
      before: this.snapshot(target, row),
      after: null,
    });
  }

  /**
   * A row's fields, as they are right now.
   *
   * Taken from the entity's column metadata rather than from the object's own
   * keys, so a loaded relation cannot end up serialized into the trail and a
   * column the object happens not to carry yet reads as null rather than
   * disappearing from the comparison.
   */
  snapshot<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    row: ObjectLiteral
  ): AuditFields {
    const fields: AuditFields = {};
    for (const column of this.dataSource.getMetadata(target).columns) {
      const name = column.propertyName;
      if (WRITE_BOOKKEEPING.has(name)) {
        continue;
      }
      const value = normalize(row[name]);
      // A `numeric` column comes back from Postgres as a string and leaves a
      // service as a number, so the same value stored twice would be recorded
      // two ways. The column says which fields those are, so the trail holds one
      // shape rather than whichever the row happened to arrive in.
      fields[name] =
        column.type === 'numeric' &&
        (typeof value === 'string' || typeof value === 'number')
          ? Number(value)
          : value;
    }
    return fields;
  }

  private async insert<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    entityId: string,
    action: AuthAuditAction,
    change: { before: AuditFields | null; after: AuditFields | null }
  ): Promise<void> {
    const row = new AuthAudit();
    row.actorId = this.actorId;
    // Auth has no service branch: `AuthPlatformAdminService` refuses a request
    // with no operator token rather than falling through to a service actor, so
    // every actor here is a person.
    row.actorKind = AuthAuditActorKind.ADMIN;
    row.entity = this.dataSource.getMetadata(target).tableName;
    row.entityId = entityId;
    row.action = action;
    row.before = change.before;
    row.after = change.after;
    await this.manager.save(row);
  }
}

/**
 * The fields that moved, or null if none did.
 *
 * Null is what implements "a write that changes nothing writes no row" (plan
 * 0077, section 8). An operator who opens the user form and saves it unchanged
 * did not change anything, and a trail that says otherwise is a trail somebody
 * has to read past.
 */
export function diffFields(
  before: AuditFields,
  after: AuditFields
): { before: AuditFields; after: AuditFields } | null {
  const wasBefore: AuditFields = {};
  const isAfter: AuditFields = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sameValue(before[key], after[key])) {
      continue;
    }
    wasBefore[key] = normalize(before[key]);
    isAfter[key] = normalize(after[key]);
  }

  return Object.keys(isAfter).length > 0
    ? { before: wasBefore, after: isAfter }
    : null;
}

/** `undefined` and a `Date` are not json; everything else already is. */
function normalize(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function sameValue(a: unknown, b: unknown): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) {
    return true;
  }
  // A numeric column arrives from Postgres as a string and leaves a service as a
  // number, so `3` and `'3'` are one value written twice rather than a change.
  // Compared only across the two types: two strings stay two strings, so a
  // `varchar` id never collapses into a number.
  if (typeof left === 'number' && typeof right === 'string') {
    return left === Number(right);
  }
  if (typeof left === 'string' && typeof right === 'number') {
    return Number(left) === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
