import { Injectable } from '@angular/core';
import {
  compositeIdOf,
  type ResourceGateway,
  type ResourcePage,
  type ResourceQuery,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { notFoundError } from '../gateway-error';
import type { ResourceGatewaysI, ResourceSource } from './resource-gateways';

/**
 * Every resource, served out of memory (plan 0004, and the workspace rule that
 * a data domain runs with no backend).
 *
 * One instance holds one table per path, so a row created on the form is there
 * when the list redraws. That is what makes the memory implementation worth
 * having beyond a spec fixture: the whole app can be driven end to end with
 * nothing listening on the gateway port.
 *
 * It paginates for real, by index, and it is the only place in this app that
 * mints a cursor. That is deliberate rather than lazy: a memory gateway that
 * answered every list in one page would let a bug in the list's own paging
 * survive every spec that used it.
 */
@Injectable({ providedIn: 'root' })
export class ResourceMemoryGateways implements ResourceGatewaysI {
  private readonly _tables = new Map<string, ResourceRow[]>();
  private readonly _seeded = new Set<string>();

  for<T extends ResourceRow>(source: ResourceSource<T>): ResourceGateway<T> {
    return new ResourceMemory<T>(this._table(source), source);
  }

  /**
   * The table for a path, seeded once.
   *
   * One table can be asked for by two callers, and only one of them knows the
   * fixture. A membership is the case: the descriptor names `MEMBERSHIP_SEED`,
   * and `DirectoryMemory` asks for the same table to keep a status change in
   * step with the zone's own membership array, with no seed at all because the
   * fixture lives a library above it. Whichever asks first used to decide, so
   * kicking somebody from the zone screen before ever opening the membership
   * list left that list permanently empty.
   *
   * So the seed is applied the first time one is offered, rather than only when
   * the table is created. It is applied **once**, tracked separately from the
   * rows, so a table an operator emptied by deleting every row is not quietly
   * refilled the next time a screen asks for it.
   */
  private _table<T extends ResourceRow>(source: ResourceSource<T>): T[] {
    const existing = this._tables.get(source.path) ?? [];
    this._tables.set(source.path, existing);

    if (source.seed !== undefined && !this._seeded.has(source.path)) {
      this._seeded.add(source.path);
      existing.push(...(source.seed as readonly ResourceRow[]));
    }

    return existing as T[];
  }
}

const DEFAULT_PAGE_SIZE = 25;

/** One resource's table. */
class ResourceMemory<T extends ResourceRow> implements ResourceGateway<T> {
  constructor(
    private readonly _rows: T[],
    private readonly _source: ResourceSource<T>
  ) {}

  async list(query: ResourceQuery): Promise<ResourcePage<T>> {
    const filters = query.filters ?? {};

    // The collection has no address until the value naming it is given, and a
    // list of everything would be the wrong answer rather than a convenient
    // one: a chain's shops are only ever read one chain at a time.
    if (this._source.collectionPath?.(filters) === null) {
      return { items: [], nextCursor: null };
    }

    const matching = this._rows.filter((row) => matches(row, filters));
    const from = cursorIndex(query.cursor);
    const size = query.limit ?? this._source.pageSize ?? DEFAULT_PAGE_SIZE;
    const items = matching.slice(from, from + size);
    const next = from + items.length;

    return {
      items,
      nextCursor: next < matching.length ? String(next) : null,
    };
  }

  async read(id: string): Promise<T> {
    const row = this._rows[this._indexOf(id)];
    if (row === undefined) {
      throw notFoundError();
    }
    return row;
  }

  /**
   * Add a row, or change the one already keyed the same way.
   *
   * A keyed resource is written with a `PUT` to the collection, which either
   * creates or replaces. A memory table that always pushed would let the same
   * item hold two prices in the same scope, which is a state the column's unique
   * index makes impossible and a screen would then have to be able to draw.
   */
  async create(input: ResourceRow): Promise<T> {
    const existing = this._rows.findIndex((row) => this._sameKey(row, input));
    if (existing !== -1) {
      const row = { ...this._rows[existing], ...input } as T;
      this._rows[existing] = row;
      return row;
    }

    const row = {
      [this._idField()]: `mem_${this._rows.length + 1}`,
      ...input,
    } as unknown as T;
    this._rows.push(row);
    return row;
  }

  async update(id: string, input: ResourceRow): Promise<T> {
    const index = this._indexOf(id);
    if (index === -1) {
      throw notFoundError();
    }
    const row = { ...this._rows[index], ...input } as T;
    this._rows[index] = row;
    return row;
  }

  async remove(id: string): Promise<void> {
    const index = this._indexOf(id);
    if (index === -1) {
      throw notFoundError();
    }
    this._rows.splice(index, 1);
  }

  /**
   * The property a row is found by.
   *
   * `id` for most things and not for all of them: a user is keyed by `userId`
   * and an admin by `adminId`, so a table that assumed `id` would answer 404 for
   * every row it holds.
   */
  private _idField(): string {
    return this._source.idField ?? 'id';
  }

  /** Where a row addressed this way is, or -1. */
  private _indexOf(id: string): number {
    const key = this._source.key;

    return key === undefined
      ? this._rows.findIndex((row) => row[this._idField()] === id)
      : this._rows.findIndex((row) => compositeIdOf(row, key) === id);
  }

  /** Whether a row and a submitted body are the same row. */
  private _sameKey(row: ResourceRow, input: ResourceRow): boolean {
    const key = this._source.key;
    return (
      key !== undefined && compositeIdOf(row, key) === compositeIdOf(input, key)
    );
  }
}

/** The offset a cursor stands for. Anything unreadable starts from the top. */
function cursorIndex(cursor: string | undefined): number {
  const index = Number(cursor);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

/**
 * Whether a row satisfies the filters.
 *
 * A substring match on every value the row holds, which is not what the backend
 * does and is not trying to be. The memory gateway exists so screens can be
 * driven without a server; matching the server's ranking would be a second
 * implementation of the search, with its own bugs, tested by nothing.
 */
function matches(
  row: ResourceRow,
  filters: Readonly<Record<string, string>> | undefined
): boolean {
  if (filters === undefined) {
    return true;
  }

  return Object.entries(filters).every(([param, value]) => {
    if (value === '') {
      return true;
    }
    const direct = row[param];
    if (direct !== undefined) {
      return String(direct).toLowerCase().includes(value.toLowerCase());
    }
    return JSON.stringify(row).toLowerCase().includes(value.toLowerCase());
  });
}
