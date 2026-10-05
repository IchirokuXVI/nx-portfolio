import {
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import {
  HARVEST_SERVICE,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ShopSections } from '../shop-sections';

/** What the harvester has for a chain. */
export type ChainSourceState =
  /** A source exists and may be fetched. */
  | 'fetched'
  /** No source, or one whose switch is off: nothing fetches the chain. */
  | 'off';

/**
 * How many price scopes a count will read before it gives up.
 *
 * A chain's general scopes are a handful. A chain with a single shop scope per
 * shop has as many as it has shops, and the list has no total, so past one
 * page the tab shows no number and not a number that is too small.
 */
const SCOPE_COUNT_PAGE = 100;

/** The key of the Sections tab of a chain: the `name` of the part. */
export const CHAIN_SECTIONS_TAB = 'sections';

/** What the tabs of a chain count, by the key of the tab. */
export type ChainTabCounts = Readonly<Record<string, number | null>>;

/**
 * What a chain's page counts beside its tabs, and what the harvester has for
 * the chain (admin plan 0056, section 3.1).
 *
 * The chain itself is the record page's: its row, its delete and its heading.
 * What no field of the row holds is here, read once for the page. It is what
 * is left of the context the chain's own page held before that plan.
 *
 * `providedIn: 'root'`, because the page asks for it while it is built. It
 * holds one chain, the one that is open: {@link of} is the page opening a
 * chain, and everything read for the one before is dropped.
 *
 * **A count is shown only when the gateway gave it.** The section count is
 * the length of a list that is read whole. The scope count is the length of
 * the first page when that page is the last, and nothing otherwise. The shop
 * count is a field of the chain and is not here.
 *
 * **The counts follow a write.** The page asks {@link of} once for each chain
 * it opens, and not again when a tab adds a section or a scope. So this reads
 * the two counts again when either resource says it was written.
 */
@Injectable({ providedIn: 'root' })
export class ChainCounts {
  private readonly _registry = inject(ResourceRegistry);
  private readonly _sections = inject(ShopSections);
  private readonly _harvest = inject(HARVEST_SERVICE);
  private readonly _changes = inject(ResourceChanges);

  private readonly _id = signal<string | null>(null);
  private readonly _sectionCount = signal<number | null>(null);
  private readonly _scopeCount = signal<number | null>(null);
  private readonly _source = signal<ChainSourceState | null>(null);

  /** So that an answer for a chain the page has left is dropped. */
  private _generation = 0;

  /** The chain that is open, or `null` before the first. */
  readonly id = this._id.asReadonly();
  /** What the harvester has for the chain, or `null` when it did not answer. */
  readonly source = this._source.asReadonly();

  constructor() {
    // A section or a scope was written, so the number beside its tab moved.
    let counted = this._counted();
    effect(() => {
      const version = this._counted();
      untracked(() => {
        const id = this._id();
        if (version !== counted && id !== null) {
          counted = version;
          void this._readSectionCount(id, this._generation);
          void this._readScopeCount(id, this._generation);
        }
      });
    });

    // A shop was added or deleted, so the chain's count of them moved. The
    // chain is said to have changed, which the column of chains follows.
    let shops = this._changes.version('locations');
    effect(() => {
      const version = this._changes.version('locations');
      untracked(() => {
        if (version !== shops) {
          shops = version;
          this._changes.wrote('supermarkets');
        }
      });
    });
  }

  /**
   * The counts beside the tabs of one chain, for `record.counts`.
   *
   * The page asks once for each chain it opens, and asking is what starts
   * the reads.
   */
  readonly of = (id: string): Signal<ChainTabCounts> => {
    this.open(id);
    return computed(() =>
      this._id() === id
        ? {
            [CHAIN_SECTIONS_TAB]: this._sectionCount(),
            'price-scopes': this._scopeCount(),
          }
        : { [CHAIN_SECTIONS_TAB]: null, 'price-scopes': null }
    );
  };

  /** What the harvester has for one chain, or `null` when it is not the open one. */
  sourceOf(id: string): ChainSourceState | null {
    return this._id() === id ? this._source() : null;
  }

  /** Open a chain. Everything held about the one before is dropped. */
  open(id: string): void {
    this._generation += 1;
    this._id.set(id);
    this._sectionCount.set(null);
    this._scopeCount.set(null);
    this._source.set(null);

    // Each of the three fails by itself: a count that could not be read is a
    // tab without a number, and never a page that will not open.
    void this._readSectionCount(id, this._generation);
    void this._readScopeCount(id, this._generation);
    void this._readSource(id, this._generation);
  }

  /**
   * Make one of a chain's scopes its default.
   *
   * A write to the chain, so it throws what the gateway refused and the list
   * that asked says so. The chain is said to have changed, and the page that
   * shows it then reads it again.
   */
  async setDefaultScope(chainId: string, priceScopeId: string): Promise<void> {
    const descriptor = this._registry.byName('supermarkets');
    if (descriptor === undefined) {
      throw new Error('A default scope needs the supermarkets resource.');
    }

    await this._registry.gatewayFor(descriptor).update(chainId, {
      defaultPriceScopeId: priceScopeId,
    });
    this._changes.wrote('supermarkets');
  }

  /** The writes that change a count held here, as one number. */
  private _counted(): number {
    return (
      this._changes.version('sections') + this._changes.version('price-scopes')
    );
  }

  private async _readSectionCount(id: string, generation: number) {
    try {
      const sections = await this._sections.chainSections(id);
      if (generation === this._generation) {
        this._sectionCount.set(sections.length);
      }
    } catch {
      if (generation === this._generation) {
        this._sectionCount.set(null);
      }
    }
  }

  private async _readScopeCount(id: string, generation: number) {
    const descriptor = this._registry.byName('price-scopes');
    if (descriptor === undefined) {
      return;
    }

    try {
      const page = await this._registry.gatewayFor(descriptor).list({
        limit: SCOPE_COUNT_PAGE,
        filters: { supermarketId: id },
      });
      if (generation === this._generation) {
        this._scopeCount.set(
          page.nextCursor === null ? page.items.length : null
        );
      }
    } catch {
      if (generation === this._generation) {
        this._scopeCount.set(null);
      }
    }
  }

  private async _readSource(id: string, generation: number) {
    try {
      const source = await this._harvest.readSource(id);
      if (generation === this._generation) {
        this._source.set(source.enabled ? 'fetched' : 'off');
      }
    } catch (error) {
      if (generation === this._generation) {
        // Not found is an answer: the chain has no source, so nothing
        // fetches it. Anything else is the harvester not answering, and the
        // header then says nothing.
        this._source.set(toGatewayError(error).status === 404 ? 'off' : null);
      }
    }
  }
}
