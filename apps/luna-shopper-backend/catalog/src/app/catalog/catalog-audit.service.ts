import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  type EntityTarget,
  type FindOptionsWhere,
  type ObjectLiteral,
} from 'typeorm';
import { AuditAction, AuditActorKind, CatalogAudit } from '../entities';
import type { CatalogActor } from './platform-admin.service';

/** A row's fields as the trail stores them: json, one level, no relations. */
export type AuditFields = Record<string, unknown>;

/**
 * Fields the trail never mentions, because none of them says anything about what
 * a row means (plan 0075, section 4).
 *
 * - `id` is already the `entityId` column, and repeating it inside the diff
 *   would double the size of the smallest useful row.
 * - `createdAt` cannot change, and `updatedAt` changes on every single write, so
 *   including it would make the "a write that changes nothing writes no row"
 *   rule unreachable: every update would carry at least one moved field.
 * - `priceObservedAt` is the same kind of fact one level down. The harvester
 *   re-stamps it on every price it re-fetches, including the great majority that
 *   have not moved, so diffing it would write one audit row per product per run
 *   and grow the trail by a catalog per run. When it moves and the price does
 *   not, nothing happened that anybody will ever ask about.
 */
const WRITE_BOOKKEEPING: ReadonlySet<string> = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'priceObservedAt',
]);

/**
 * Who changed a catalog row, and what it said before (plan 0075).
 *
 * Every write behind `/v1/admin/catalog/**`, and every write the harvester makes
 * through `CatalogClient`, goes through {@link write}. Reads are not audited: a
 * back office with one operator generates no interesting read trail, and a
 * 4,000 row catalog browsed through a paginated list would write far more rows
 * for its reads than for its writes.
 *
 * ## The transaction is the point
 *
 * {@link write} opens one transaction and hands the caller a {@link AuditedWrite}
 * that persists the change and the audit row through the same
 * {@link EntityManager}. That is not tidiness. A trail written separately can
 * succeed when the change fails, or fail when the change succeeds, and a trail
 * that is sometimes wrong is worse than no trail at all, because it gets
 * trusted.
 *
 * ## The actor comes from the gate, not from the caller
 *
 * `PlatformAdminService.requireAdmin` returns a {@link CatalogActor} saying whom
 * it let through and on what evidence, so nothing here asks a second time and
 * nothing can record an actor the gate did not verify. A harvest run started by
 * the owner still writes as the harvester, with `actorKind = SERVICE`, because
 * the write is the harvester's: attributing four thousand price updates to the
 * person who pressed a button would make the trail claim they typed four
 * thousand prices.
 */
@Injectable()
export class CatalogAuditService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Run a change and its audit rows in one transaction.
   *
   * Reads a caller performs through its own injected repositories are outside
   * this transaction, deliberately and unchanged: the guarantee being bought is
   * that the trail matches what was committed, not that every validating lookup
   * became serializable at the same time.
   */
  write<T>(
    actor: CatalogActor,
    work: (tx: AuditedWrite) => Promise<T>
  ): Promise<T> {
    return this.dataSource.transaction((manager) =>
      work(new AuditedWrite(manager, this.dataSource, actor))
    );
  }
}

/**
 * One transaction, and the changes recorded inside it.
 *
 * Handed to the callback of {@link CatalogAuditService.write}. Every method here
 * both persists and records, so a write site cannot do one and forget the other.
 */
export class AuditedWrite {
  constructor(
    /** For a caller that must read or write something these methods do not cover. */
    readonly manager: EntityManager,
    private readonly dataSource: DataSource,
    private readonly actor: CatalogActor
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
      // Every catalog entity keys on `id`, but nothing in `T` says so, so the
      // criteria cannot be expressed in the generic.
      { id: entityId } as unknown as FindOptionsWhere<T>
    );
    await this.insert(target, entityId, AuditAction.DELETE, {
      before,
      after: null,
    });
  }

  /**
   * Record a creation another call persisted.
   *
   * The batch price write saves several hundred rows in one chunked statement,
   * which is the whole reason it exists, so it records after the fact rather
   * than row by row.
   */
  async recordCreate<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    row: T
  ): Promise<void> {
    await this.insert(target, row['id'] as string, AuditAction.CREATE, {
      before: null,
      after: this.snapshot(target, row),
    });
  }

  /**
   * Record a deletion another call performed.
   *
   * The counterpart of {@link recordCreate}, and it exists for the same reason:
   * a revert removes every price one run wrote in a single statement (plan
   * 0082, section 2), so the rows are read, deleted together, and recorded
   * afterwards. The caller has to hold the rows it read, because a row deleted
   * by criteria cannot be described after the fact.
   */
  async recordDelete<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    row: T
  ): Promise<void> {
    await this.insert(target, row['id'] as string, AuditAction.DELETE, {
      before: this.snapshot(target, row),
      after: null,
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
    await this.insert(target, row['id'] as string, AuditAction.UPDATE, moved);
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
      // service as a number, so the same price stored twice would be recorded
      // two ways. The column says which fields those are, so the trail can hold
      // one shape rather than whichever the row happened to arrive in.
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
    action: AuditAction,
    change: { before: AuditFields | null; after: AuditFields | null }
  ): Promise<void> {
    const row = new CatalogAudit();
    row.actorId = this.actor.actorId;
    row.actorKind =
      this.actor.kind === 'admin'
        ? AuditActorKind.ADMIN
        : AuditActorKind.SERVICE;
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
 * Null is what implements section 4's first mitigation, and it is the important
 * one: the harvester re-fetches prices that mostly have not changed, so skipping
 * the identical case removes most of the volume and most of the noise at once.
 * A price that did not change is not history.
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
  // number, so `1.75` and `'1.75'` are the same price written twice rather than
  // a change. Compared only across the two types: two strings stay two strings,
  // so a `varchar` external key of `'4661'` never collapses into `'4661.0'`.
  if (typeof left === 'number' && typeof right === 'string') {
    return left === Number(right);
  }
  if (typeof left === 'string' && typeof right === 'number') {
    return Number(left) === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
