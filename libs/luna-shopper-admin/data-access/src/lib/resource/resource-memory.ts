import { Injectable } from '@angular/core';
import type {
  ResourceGateway,
  ResourcePage,
  ResourceQuery,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
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

  for<T extends ResourceRow>(source: ResourceSource<T>): ResourceGateway<T> {
    const rows = this._table(source);
    return new ResourceMemory<T>(
      rows,
      source.pageSize ?? DEFAULT_PAGE_SIZE,
      source.idField ?? 'id'
    );
  }

  /** The table for a path, seeded the first time it is asked for. */
  private _table<T extends ResourceRow>(source: ResourceSource<T>): T[] {
    const existing = this._tables.get(source.path);
    if (existing !== undefined) {
      return existing as T[];
    }

    const rows = [...(source.seed ?? [])] as ResourceRow[];
    this._tables.set(source.path, rows);
    return rows as T[];
  }
}

const DEFAULT_PAGE_SIZE = 25;

/** One resource's table. */
class ResourceMemory<T extends ResourceRow> implements ResourceGateway<T> {
  constructor(
    private readonly _rows: T[],
    private readonly _pageSize: number,
    /**
     * The property a row is found by.
     *
     * `id` for most things and not for all of them: a user is keyed by
     * `userId` and an admin by `adminId`, so a table that assumed `id` would
     * answer 404 for every row it holds.
     */
    private readonly _idField: string
  ) {}

  async list(query: ResourceQuery): Promise<ResourcePage<T>> {
    const matching = this._rows.filter((row) => matches(row, query.filters));
    const from = cursorIndex(query.cursor);
    const size = query.limit ?? this._pageSize;
    const items = matching.slice(from, from + size);
    const next = from + items.length;

    return {
      items,
      nextCursor: next < matching.length ? String(next) : null,
    };
  }

  async read(id: string): Promise<T> {
    const row = this._rows.find((entry) => entry[this._idField] === id);
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  async create(input: ResourceRow): Promise<T> {
    const row = {
      [this._idField]: `mem_${this._rows.length + 1}`,
      ...input,
    } as unknown as T;
    this._rows.push(row);
    return row;
  }

  async update(id: string, input: ResourceRow): Promise<T> {
    const index = this._rows.findIndex((entry) => entry[this._idField] === id);
    if (index === -1) {
      throw notFound();
    }
    const row = { ...this._rows[index], ...input } as T;
    this._rows[index] = row;
    return row;
  }

  async remove(id: string): Promise<void> {
    const index = this._rows.findIndex((entry) => entry[this._idField] === id);
    if (index === -1) {
      throw notFound();
    }
    this._rows.splice(index, 1);
  }
}

/** A 404 shaped the way the real gateway's would be. */
function notFound(): GatewayError {
  return new GatewayError({
    code: 'not_found',
    status: 404,
    correlationId: '',
  });
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
