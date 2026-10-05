import { computed, inject, Injectable } from '@angular/core';
import { DashboardStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  ResourceRegistry,
  type SectionCounts,
} from '@portfolio/luna-shopper-admin/feature-resource';

/**
 * How many join requests wait, for the rail and for the Zones tab (admin plan
 * 0045, target 1).
 *
 * A request to join a zone waits until somebody in the zone, or an operator,
 * lets the person in or refuses them. The number comes with the dashboard
 * read, so the rail, the tab and the Overview's tile are one read and cannot
 * disagree.
 *
 * **It watches from the moment it is built**, and the frame builds it, because
 * the count on the rail is on every screen. The store counts its watchers, so
 * the overview opening and closing does not stop these reads.
 *
 * Root scoped, like the store it reads.
 */
@Injectable({ providedIn: 'root' })
export class ShoppersStatus implements SectionCounts {
  private readonly _store = inject(DashboardStore);
  private readonly _registry = inject(ResourceRegistry);

  constructor() {
    this._store.watch();
  }

  /**
   * The requests that wait, or `null` while nothing is known: before the first
   * read answers, and when core did not answer it.
   */
  readonly pending = computed<number | null>(
    () => this._store.document()?.core?.memberships.pending ?? null
  );

  /**
   * What waits behind one of the section's tabs, which the frame asks by the
   * path of each link. Only Zones has a count.
   */
  countAt(path: string): number | null {
    return path === this._zonesLink() ? this.pending() : null;
  }

  /**
   * Read the count again, after a request was decided.
   *
   * Waiting a minute for the next read would leave the rail saying a request
   * waits that the zone's page no longer shows.
   */
  refresh(): void {
    void this._store.load();
  }

  /** The Zones tab, as the path its link carries. */
  private _zonesLink(): string | null {
    const path = this._registry.pathOf('zones');
    return path === null ? null : path.join('/').replace('//', '/');
  }
}
