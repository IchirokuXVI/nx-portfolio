import { signal } from '@angular/core';
import type { ReferenceLookup } from '@portfolio/luna-shopper-admin/ui';

/**
 * What each product group is called, resolved once per id (admin plan 0035,
 * section 2).
 *
 * The bulk group screens say where a product is now before it moves, and a
 * product carries only its group's id. A group that cannot be resolved keeps
 * its id on screen, because the id is true and a blank would not be.
 */
export class GroupNames {
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _asked = new Set<string>();

  readonly names = this._names.asReadonly();

  constructor(private readonly _lookup: ReferenceLookup) {}

  async resolve(ids: readonly (string | null)[]): Promise<void> {
    const fresh = [
      ...new Set(ids.filter((id): id is string => id !== null)),
    ].filter((id) => !this._asked.has(id));
    for (const id of fresh) {
      this._asked.add(id);
    }

    await Promise.all(
      fresh.map(async (id) => {
        const option = await this._lookup.resolve('product-groups', id);
        const next = new Map(this._names());
        next.set(id, option?.title ?? id);
        this._names.set(next);
      })
    );
  }
}
