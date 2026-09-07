import { inject, Injectable, signal } from '@angular/core';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';

/**
 * What a chain is called, for the screens that are handed its id.
 *
 * The gateway sends ids because a queue and a run are per chain and the chain's
 * name belongs to catalog, so a screen that wants the name resolves it through
 * the reference lookup this app already has. A chain the reference cannot name
 * shows its id (plan 0007, section 4).
 *
 * A service rather than a field on a component, because admin plan 0022 split
 * one dashboard into four and two of them ask this question: the overview, whose
 * work waiting tiles name a chain per queue, and the harvester's, whose run in
 * flight names the chain it is walking. `providedIn: 'root'`, so walking between
 * those two screens does not re-resolve what is already known.
 */
@Injectable({ providedIn: 'root' })
export class ChainNames {
  private readonly _references = inject(ResourceReferences);
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());

  /** The chain's name, or its id where the reference could not name it. */
  nameOf(supermarketId: string): string {
    return this._names().get(supermarketId) ?? supermarketId;
  }

  /**
   * Name the chains not named yet.
   *
   * One read per chain, of which there are a handful, and only for an id the map
   * does not hold: the document is re-read every minute and the chains do not
   * change between polls. A failure costs a name rather than the screen, because
   * `resolve` answers `null` for a reference that outlived what it points at and
   * the caller then shows the id.
   */
  async resolve(ids: readonly string[]): Promise<void> {
    const known = this._names();
    const wanted = ids.filter((id) => !known.has(id));
    if (wanted.length === 0) {
      return;
    }

    const resolved = await Promise.all(
      wanted.map(
        async (id) =>
          [id, await this._references.resolve('supermarkets', id)] as const
      )
    );

    this._names.update((names) => {
      const next = new Map(names);
      for (const [id, option] of resolved) {
        if (option !== null) {
          next.set(id, option.title);
        }
      }
      return next;
    });
  }
}
