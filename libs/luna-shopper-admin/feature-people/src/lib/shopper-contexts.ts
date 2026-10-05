import { computed, inject, Injectable, signal } from '@angular/core';
import { toGatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { ResourceRow } from '@portfolio/luna-shopper-admin/models';
import type { UserRow, ZoneRow } from './people-seed';

/**
 * One row a page is about, read once for the page and every tab under it.
 *
 * The header reads the name from it and each tab reads what it lists from it.
 * Without it each of those would read the row for itself, and after a write
 * they would disagree until the next reload. `ChainContext` is the same idea
 * for a chain (admin plan 0042).
 *
 * `open` forgets the row that was there. `reload` keeps it on screen while the
 * new answer is on its way, which is what a page wants after an action.
 */
abstract class RowContext<T extends ResourceRow> {
  private readonly _registry = inject(ResourceRegistry);

  private readonly _id = signal<string | null>(null);
  private readonly _row = signal<T | null>(null);
  private readonly _status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly _errorKey = signal<string | null>(null);

  /** So that an answer for a row the page has left is dropped. */
  private _generation = 0;

  readonly id = this._id.asReadonly();
  readonly row = this._row.asReadonly();
  readonly status = this._status.asReadonly();
  /** Why the row could not be read, as a key. */
  readonly errorKey = this._errorKey.asReadonly();

  /** The `name` of the resource the row belongs to. */
  protected abstract readonly resource: string;

  async open(id: string): Promise<void> {
    this._generation += 1;
    this._id.set(id);
    this._row.set(null);
    this._status.set('loading');
    this._errorKey.set(null);
    await this.reload();
  }

  async reload(): Promise<void> {
    const id = this._id();
    const descriptor = this._registry.byName(this.resource);
    if (id === null || descriptor === undefined) {
      return;
    }
    const generation = this._generation;

    try {
      const row = await this._registry.gatewayFor(descriptor).read(id);
      if (generation !== this._generation) {
        return;
      }
      this._row.set(row as T);
      this._status.set('ready');
    } catch (error) {
      if (generation !== this._generation) {
        return;
      }
      this._errorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
      this._status.set('error');
    }
  }
}

/**
 * The person a page is about (admin plan 0045, target 3). Provided by
 * `PersonPage`, so it lives exactly as long as a person is open.
 */
@Injectable()
export class PersonContext extends RowContext<UserRow> {
  protected readonly resource = 'users';
}

/**
 * The zone a page is about (admin plan 0045, target 5). Provided by
 * `ZonePage`.
 *
 * The read carries the zone's members and its lists, so the Members tab and
 * the counts on the tabs come from the same answer the header does.
 */
@Injectable()
export class ZoneContext extends RowContext<ZoneRow> {
  protected readonly resource = 'zones';

  /**
   * What the owner is called: the name they go by in this zone.
   *
   * The read of one zone carries the owner's id and no name. The owner is a
   * member, and a member carries a name, so that is the one shown. An owner
   * who is no member any more is shown as the id, and a zone with no owner
   * answers `null`.
   */
  readonly ownerName = computed<string | null>(() => {
    const zone = this.row();
    if (zone === null || zone.ownerUserId === null) {
      return null;
    }
    const owner = zone.members.find(
      (member) => member.userId === zone.ownerUserId
    );
    return owner?.username ?? zone.ownerName ?? zone.ownerUserId;
  });
}
